import { TransactionBuilder } from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail } from '@/lib/auth/store';
import {
  submitSignedTransaction,
  getInvokeContractDetails,
  getInvokeContractArgs,
  scValToBytes,
  scValToAddress,
} from '@/lib/wallet/submit';
import { NETWORK_PASSPHRASE } from '@/lib/wallet/network';
import { db, schema } from '@/lib/db';
import { eq, and, or } from 'drizzle-orm';
import { incrementMetric } from '@/lib/metrics';

function getEscrowContractId(): string {
  const id = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID;
  if (!id) {
    throw new Error('NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured');
  }
  return id;
}

function validateSignedClaim(
  signedXdr: string,
  expectedClaimHash: string,
  expectedRecipientWallet: string
) {
  const envelope = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  if (envelope.operations.length !== 1) {
    throw new Error('Claim transaction must contain exactly one operation');
  }

  const op = envelope.operations[0];
  const details = getInvokeContractDetails(op);
  if (!details) {
    throw new Error('Transaction does not invoke a contract');
  }
  if (details.contractId !== getEscrowContractId()) {
    throw new Error('Transaction invokes the wrong contract');
  }
  if (details.functionName !== 'claim') {
    throw new Error('Transaction must call claim');
  }

  const args = getInvokeContractArgs(op);
  if (!args || args.length !== 2) {
    throw new Error('claim argument count is malformed');
  }

  const claimHash = scValToBytes(args[0]).toString('hex');
  const recipientWallet = scValToAddress(args[1]);

  if (claimHash !== expectedClaimHash) {
    throw new Error('Claim hash does not match');
  }
  if (recipientWallet !== expectedRecipientWallet) {
    throw new Error('Recipient wallet does not match');
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

  const user = await getUserByEmail(session.email);
  if (!user || !user.walletContractId) {
    return NextResponse.json({ error: 'Wallet not deployed' }, { status: 404 });
  }

  let body: { claimLinkId?: string; signedXdr?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { claimLinkId, signedXdr } = body;
  if (!claimLinkId || !signedXdr) {
    return NextResponse.json(
      { error: 'claimLinkId and signedXdr are required' },
      { status: 400 }
    );
  }

  const conditions = [
    eq(schema.claimLinks.id, claimLinkId),
    eq(schema.claimLinks.status, 'pending'),
  ];

  const recipientConditions = [];
  if (user.phone) {
    recipientConditions.push(eq(schema.claimLinks.recipientPhone, user.phone));
  }
  if (user.email) {
    recipientConditions.push(eq(schema.claimLinks.recipientEmail, user.email));
  }

  if (recipientConditions.length === 0) {
    return NextResponse.json(
      { error: 'Your account has no phone or email to match against' },
      { status: 403 }
    );
  }

  const [link] = await db
    .select()
    .from(schema.claimLinks)
    .where(and(...conditions, or(...recipientConditions)));

  if (!link) {
    return NextResponse.json(
      { error: 'Claim link not found or not available to you' },
      { status: 404 }
    );
  }

  if (new Date() > link.expiry) {
    return NextResponse.json(
      { error: 'Claim link has expired' },
      { status: 410 }
    );
  }

  try {
    validateSignedClaim(signedXdr, link.claimHash, user.walletContractId);
    const result = await submitSignedTransaction(signedXdr);

    await db
      .update(schema.claimLinks)
      .set({ status: 'claimed', claimedAt: new Date() })
      .where(eq(schema.claimLinks.id, claimLinkId));

    await incrementMetric('wallet.claim.success');
    return NextResponse.json({ hash: result.hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Claim failed';
    console.error('Claim submission failed:', err);
    await incrementMetric('wallet.claim.failure');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
