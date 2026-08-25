import { TransactionBuilder } from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail, verifyPinForUser } from '@/lib/auth/store';
import { getUsdcContractId, getXlmContractId } from '@/lib/wallet/assets';
import {
  getInvokeContractDetails,
  getInvokeContractArgs,
  scValToAddress,
  submitSignedTransaction,
} from '@/lib/wallet/submit';
import { getTokenBalance } from '@/lib/wallet/token';
import { amountToBaseUnits, i128ToBigInt } from '@/lib/wallet/amount';
import { resolveRecipient } from '@/lib/wallet/recipient';
import { NETWORK_PASSPHRASE } from '@/lib/wallet/network';

export interface TransferRequest {
  signedXdr: string;
  asset: 'USDC' | 'XLM';
  amount: string;
  recipient: string;
  pin: string;
}

function getTokenContractId(asset: 'USDC' | 'XLM'): string {
  return asset === 'USDC' ? getUsdcContractId() : getXlmContractId();
}

function validateAmount(amount: string): string | null {
  if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    return 'Amount must be a positive number';
  }
  const parts = amount.split('.');
  if (parts.length > 2) {
    return 'Invalid amount format';
  }
  if (parts[1] && parts[1].length > 7) {
    return 'Amount cannot have more than 7 decimal places';
  }
  return null;
}

class TransferValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferValidationError';
  }
}

/**
 * Validate that the signed XDR is a SAC `transfer(from, to, amount)` call
 * from the user's wallet contract to the resolved recipient for the stated
 * amount. Returns the parsed transaction on success.
 */
function validateSignedTransfer(
  signedXdr: string,
  walletContractId: string,
  tokenContractId: string,
  recipientAddress: string,
  expectedAmount: bigint
) {
  const envelope = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  if (envelope.operations.length !== 1) {
    throw new TransferValidationError(
      'Transfer transaction must contain exactly one operation'
    );
  }

  const op = envelope.operations[0];
  if (!op) {
    throw new TransferValidationError(
      'Transfer transaction contains no operations'
    );
  }

  const details = getInvokeContractDetails(op);
  if (!details) {
    throw new TransferValidationError(
      'Transfer transaction does not invoke a contract'
    );
  }

  if (details.contractId !== tokenContractId) {
    throw new TransferValidationError(
      'Transfer transaction invokes the wrong token contract'
    );
  }

  if (details.functionName !== 'transfer') {
    throw new TransferValidationError(
      'Transfer transaction must call the transfer function'
    );
  }

  const args = getInvokeContractArgs(op);
  if (!args || args.length !== 3) {
    throw new TransferValidationError(
      'Transfer function arguments are malformed'
    );
  }

  const fromAddress = scValToAddress(args[0]);
  const toAddress = scValToAddress(args[1]);
  const amount = i128ToBigInt(args[2]);

  if (fromAddress !== walletContractId) {
    throw new TransferValidationError(
      'Transfer is not from the user wallet'
    );
  }

  if (toAddress !== recipientAddress) {
    throw new TransferValidationError(
      'Transfer recipient does not match resolved address'
    );
  }

  if (amount !== expectedAmount) {
    throw new TransferValidationError(
      'Transfer amount does not match requested amount'
    );
  }

  return envelope;
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = getUserByEmail(session.email);
  if (!user || !user.walletContractId) {
    return NextResponse.json({ error: 'Wallet not deployed' }, { status: 404 });
  }

  let body: TransferRequest;
  try {
    body = (await request.json()) as TransferRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { signedXdr, asset, amount, recipient, pin } = body;

  if (!signedXdr || typeof signedXdr !== 'string') {
    return NextResponse.json({ error: 'signedXdr is required' }, { status: 400 });
  }

  if (!asset || (asset !== 'USDC' && asset !== 'XLM')) {
    return NextResponse.json({ error: 'Asset must be USDC or XLM' }, { status: 400 });
  }

  const amountError = validateAmount(amount);
  if (amountError) {
    return NextResponse.json({ error: amountError }, { status: 400 });
  }

  if (!recipient || typeof recipient !== 'string') {
    return NextResponse.json({ error: 'Recipient is required' }, { status: 400 });
  }

  const resolved = resolveRecipient(recipient);
  if (!resolved) {
    return NextResponse.json(
      { error: 'Recipient not found. Check the username, phone, or Stellar address.' },
      { status: 404 }
    );
  }

  if (!pin || typeof pin !== 'string') {
    return NextResponse.json({ error: 'PIN is required' }, { status: 400 });
  }

  if (!verifyPinForUser(user.email, pin)) {
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
  }

  try {
    const tokenContractId = getTokenContractId(asset);
    const baseAmount = amountToBaseUnits(amount);

    const balance = await getTokenBalance(tokenContractId, user.walletContractId);
    if (baseAmount > balance) {
      return NextResponse.json(
        { error: `Insufficient ${asset} balance` },
        { status: 400 }
      );
    }

    validateSignedTransfer(
      signedXdr,
      user.walletContractId,
      tokenContractId,
      resolved.address,
      baseAmount
    );

    const result = await submitSignedTransaction(signedXdr);
    return NextResponse.json({ hash: result.hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transfer failed';
    console.error('Transfer failed:', err);
    const status = err instanceof TransferValidationError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
