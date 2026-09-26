import { TransactionBuilder } from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { requireWalletUser } from '@/lib/auth/route-guard';
import { normalizePhone } from '@/lib/auth/store';
import { enforceFeePayerRateLimit } from '@/lib/rate-limit';
import { isValidPhoneFormat, isValidEmailFormat } from '@/lib/wallet/recipient-format';
import { getUsdcContractId, getXlmContractId } from '@/lib/wallet/assets';
import { amountToBaseUnits, i128ToBigInt } from '@/lib/wallet/amount';
import {
  submitSignedTransaction,
  getInvokeContractDetails,
  getInvokeContractArgs,
  scValToAddress,
  scValToBytes,
  scValToU64,
} from '@/lib/wallet/submit';
import { NETWORK_PASSPHRASE } from '@/lib/wallet/network';
import { encryptSecret } from '@/lib/wallet/claim-secrets';
import { db, schema } from '@/lib/db';
import { deliverClaimLinkNotification } from '@/lib/notifications';
import type { ClaimLinkNotificationInput } from '@/lib/notifications';
import { createHash } from 'node:crypto';
import { rpc } from '@stellar/stellar-sdk';
import { RPC_URL } from '@/lib/wallet/network';

function getTokenContractId(asset: 'USDC' | 'XLM'): string {
  return asset === 'USDC' ? getUsdcContractId() : getXlmContractId();
}

/**
 * Stellar closes a ledger roughly every 5 seconds. The escrow contract counts
 * in ledgers; everything the app shows the user counts in time, so one of
 * these conversions is unavoidable. Keep it in one place.
 */
const LEDGER_SECONDS = 5;
const LEDGERS_PER_DAY = Math.floor((24 * 60 * 60) / LEDGER_SECONDS);
/** How stale a prepared deposit may be when it arrives: ~20 minutes. */
const MAX_PREPARE_AGE_LEDGERS = 240;
/** Slack for the client and the server reading different RPC nodes. */
const MAX_LEDGER_SKEW = 12;

function getEscrowContractId(): string {
  const id = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID;
  if (!id) {
    throw new Error('NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured');
  }
  return id;
}

function hashRecipientId(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

function validateAmount(amount: string): string | null {
  if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    return 'Amount must be a positive number';
  }
  const parts = amount.split('.');
  if (parts[1] && parts[1].length > 7) {
    return 'Amount cannot have more than 7 decimal places';
  }
  return null;
}

class ClaimLinkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaimLinkValidationError';
  }
}

async function getCurrentLedger(): Promise<number> {
  const server = new rpc.Server(RPC_URL);
  const latest = await server.getLatestLedger();
  return latest.sequence;
}

function validateSignedDeposit(
  signedXdr: string,
  walletContractId: string,
  tokenContractId: string,
  expectedAmount: bigint,
  expectedClaimHash: string,
  expectedRecipientIdHash: string,
  expectedExpiryLedger: number
) {
  const envelope = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  if (envelope.operations.length !== 1) {
    throw new ClaimLinkValidationError(
      'Deposit transaction must contain exactly one operation'
    );
  }

  const op = envelope.operations[0];
  const details = getInvokeContractDetails(op);
  if (!details) {
    throw new ClaimLinkValidationError('Transaction does not invoke a contract');
  }
  if (details.contractId !== getEscrowContractId()) {
    throw new ClaimLinkValidationError('Transaction invokes the wrong contract');
  }
  if (details.functionName !== 'deposit') {
    throw new ClaimLinkValidationError('Transaction must call deposit');
  }

  const args = getInvokeContractArgs(op);
  if (!args || args.length !== 6) {
    throw new ClaimLinkValidationError('deposit argument count is malformed');
  }

  const sender = scValToAddress(args[0]);
  const token = scValToAddress(args[1]);
  const amount = i128ToBigInt(args[2]);
  const claimHash = scValToBytes(args[3]).toString('hex');
  const recipientIdHash = scValToBytes(args[4]).toString('hex');
  const expiry = Number(scValToU64(args[5]));

  if (sender !== walletContractId) {
    throw new ClaimLinkValidationError('Sender does not match user wallet');
  }
  if (token !== tokenContractId) {
    throw new ClaimLinkValidationError('Token contract does not match asset');
  }
  if (amount !== expectedAmount) {
    throw new ClaimLinkValidationError('Amount does not match request');
  }
  if (claimHash !== expectedClaimHash) {
    throw new ClaimLinkValidationError('Claim hash does not match');
  }
  if (recipientIdHash !== expectedRecipientIdHash) {
    throw new ClaimLinkValidationError('Recipient ID hash does not match');
  }
  if (expiry !== expectedExpiryLedger) {
    throw new ClaimLinkValidationError('Expiry ledger does not match request');
  }

  return envelope;
}

export async function POST(request: NextRequest) {
  const guard = await requireWalletUser();
  if (!guard.ok) {
    return guard.response;
  }
  const user = guard.value;

  let body: {
    signedXdr?: string;
    asset?: string;
    amount?: string;
    recipient?: string;
    expiryDays?: number;
    expiryLedger?: number;
    claimHash?: string;
    secret?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    signedXdr,
    asset,
    amount,
    recipient,
    expiryDays,
    expiryLedger,
    claimHash,
    secret,
  } = body;

  if (
    !signedXdr ||
    !asset ||
    !amount ||
    !recipient ||
    !expiryDays ||
    !expiryLedger ||
    !claimHash ||
    !secret
  ) {
    return NextResponse.json(
      { error: 'Missing required fields' },
      { status: 400 }
    );
  }

  if (asset !== 'USDC' && asset !== 'XLM') {
    return NextResponse.json({ error: 'Asset must be USDC or XLM' }, { status: 400 });
  }

  const amountError = validateAmount(amount);
  if (amountError) {
    return NextResponse.json({ error: amountError }, { status: 400 });
  }

  const isPhone = isValidPhoneFormat(recipient);
  const isEmail = isValidEmailFormat(recipient);
  if (!isPhone && !isEmail) {
    return NextResponse.json(
      { error: 'Recipient must be a phone number or email address' },
      { status: 400 }
    );
  }

  if (
    !Number.isInteger(expiryDays) ||
    expiryDays < 1 ||
    expiryDays > 30
  ) {
    return NextResponse.json(
      { error: 'Expiry must be an integer between 1 and 30 days' },
      { status: 400 }
    );
  }

  const tokenContractId = getTokenContractId(asset);
  const baseAmount = amountToBaseUnits(amount);
  const normalizedRecipient = isPhone
    ? normalizePhone(recipient)
    : recipient.trim().toLowerCase();
  const recipientIdHash = hashRecipientId(normalizedRecipient);

  // Declared out here so the notification can be delivered AFTER the try
  // block has decided the response. See the comment below the catch.
  let response: NextResponse;
  let notification: ClaimLinkNotificationInput;

  try {
    const currentLedger = await getCurrentLedger();

    // `expiryLedger` was computed by the client at prepare time and signed
    // into the transaction, so it encodes the ledger the client saw:
    //   expiryLedger = prepareLedger + expiryDays * LEDGERS_PER_DAY
    // Recovering that and comparing it to the ledger now tells us how stale
    // the prepared transaction is.
    //
    // This used to be a +/- 1 DAY window, which is far wider than the gap it
    // needs to tolerate -- a few seconds while the user confirms -- and wide
    // enough that a badly stale transaction was accepted and then stored with
    // an expiry derived from `expiryDays` instead, disagreeing with the chain
    // by up to a day (issue #137). A small negative drift is allowed because
    // the client and the server can read the ledger from different RPC nodes.
    const impliedPrepareLedger =
      expiryLedger - expiryDays * LEDGERS_PER_DAY;
    const drift = currentLedger - impliedPrepareLedger;
    if (drift < -MAX_LEDGER_SKEW || drift > MAX_PREPARE_AGE_LEDGERS) {
      return NextResponse.json(
        { error: 'Expiry ledger is out of expected range for the given days' },
        { status: 400 }
      );
    }

    validateSignedDeposit(
      signedXdr,
      user.walletContractId,
      tokenContractId,
      baseAmount,
      claimHash,
      recipientIdHash,
      expiryLedger
    );

    const limited = await enforceFeePayerRateLimit(
      request,
      'wallet.claim-links.create',
      user.email
    );
    if (limited) {
      return limited;
    }

    const result = await submitSignedTransaction(signedXdr);

    const now = new Date();
    // Derived from the signed ledger, NOT from `expiryDays`. The contract
    // enforces `expiryLedger`; a timestamp computed independently from the
    // requested number of days drifts away from it by however long the user
    // took to confirm, plus whatever the range check let through (issue
    // #137). Going through the ledger keeps the two answers to "when does
    // this expire?" the same one.
    const expiryDate = new Date(
      now.getTime() + (expiryLedger - currentLedger) * LEDGER_SECONDS * 1000
    );

    const [link] = await db
      .insert(schema.claimLinks)
      .values({
        senderEmail: user.email,
        recipientPhone: isPhone ? normalizedRecipient : null,
        recipientEmail: isEmail ? normalizedRecipient : null,
        tokenContractId,
        amount: baseAmount.toString(),
        claimHash,
        secretCiphertext: encryptSecret(secret),
        expiry: expiryDate,
        expiryLedger,
        status: 'pending',
        txHash: result.hash,
        createdAt: now,
      })
      .returning();

    response = NextResponse.json({ hash: result.hash, claimLinkId: link.id });
    notification = {
      claimLinkId: link.id,
      channel: isPhone ? 'sms' : 'email',
      recipient: normalizedRecipient,
      amount,
      asset,
    };
  } catch (err) {
    const message =
      err instanceof ClaimLinkValidationError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Failed to create claim link';
    console.error('Create claim link failed:', err);
    return NextResponse.json(
      { error: message },
      { status: err instanceof ClaimLinkValidationError ? 400 : 500 }
    );
  }

  // Past this point the escrow deposit is on chain and the claim link row is
  // committed, so the caller has succeeded whatever happens next. Notification
  // delivery therefore happens outside the try, against an already-built
  // response, and `deliverClaimLinkNotification` additionally never throws.
  // Either guard alone would be enough; both are here because getting this
  // wrong means the user is shown an error and can authorize a SECOND deposit
  // for the same payment (issue #120).
  await deliverClaimLinkNotification(notification);
  return response;
}
