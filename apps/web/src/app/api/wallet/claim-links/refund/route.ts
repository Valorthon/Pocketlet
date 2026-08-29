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
} from '@/lib/wallet/submit';
import { NETWORK_PASSPHRASE } from '@/lib/wallet/network';
import { db, schema } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { incrementMetric } from '@/lib/metrics';

function getEscrowContractId(): string {
  const id = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID;
  if (!id) {
    throw new Error('NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured');
  }
  return id;
}

function validateSignedRefund(signedXdr: string, expectedClaimHash: string) {
  const envelope = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  if (envelope.operations.length !== 1) {
    throw new Error('Refund transaction must contain exactly one operation');
  }

  const op = envelope.operations[0];
  const details = getInvokeContractDetails(op);
  if (!details) {
    throw new Error('Transaction does not invoke a contract');
  }
  if (details.contractId !== getEscrowContractId()) {
    throw new Error('Transaction invokes the wrong contract');
  }
  if (details.functionName !== 'refund') {
    throw new Error('Transaction must call refund');
  }

  const args = getInvokeContractArgs(op);
  if (!args || args.length !== 1) {
    throw new Error('refund argument count is malformed');
  }

  const claimHash = scValToBytes(args[0]).toString('hex');
  if (claimHash !== expectedClaimHash) {
    throw new Error('Claim hash does not match');
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

  const [link] = await db
    .select()
    .from(schema.claimLinks)
    .where(
      and(
        eq(schema.claimLinks.id, claimLinkId),
        eq(schema.claimLinks.senderEmail, user.email),
        eq(schema.claimLinks.status, 'pending')
      )
    );

  if (!link) {
    return NextResponse.json(
      { error: 'Claim link not found' },
      { status: 404 }
    );
  }

  if (new Date() <= link.expiry) {
    return NextResponse.json(
      { error: 'Claim link has not expired yet' },
      { status: 400 }
    );
  }

  try {
    validateSignedRefund(signedXdr, link.claimHash);
    const result = await submitSignedTransaction(signedXdr);

    await db
      .update(schema.claimLinks)
      .set({ status: 'refunded' })
      .where(eq(schema.claimLinks.id, claimLinkId));

    await incrementMetric('wallet.refund.success');
    return NextResponse.json({ hash: result.hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refund failed';
    console.error('Refund submission failed:', err);
    await incrementMetric('wallet.refund.failure');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
