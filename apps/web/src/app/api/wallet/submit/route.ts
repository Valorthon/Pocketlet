import {
  Address,
  FeeBumpTransaction,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail } from '@/lib/auth/store';
import { submitSignedTransaction } from '@/lib/wallet/submit';
import { NETWORK_PASSPHRASE } from '@/lib/wallet/network';

export interface SubmitRequest {
  /** Base64-encoded signed Soroban transaction envelope. */
  signedXdr: string;
}

/**
 * Submit a user-signed Soroban transaction with the platform fee payer.
 *
 * The endpoint performs lightweight validation: the transaction must parse,
 * contain at least one Soroban operation, and the source must be the user's
 * own smart-wallet contract. Operation-level semantics are enforced on-chain
 * by the wallet contract's __check_auth.
 */
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

  let body: SubmitRequest;
  try {
    body = (await request.json()) as SubmitRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { signedXdr } = body;
  if (!signedXdr || typeof signedXdr !== 'string') {
    return NextResponse.json({ error: 'signedXdr is required' }, { status: 400 });
  }

  try {
    const envelope = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
    if (envelope instanceof FeeBumpTransaction) {
      return NextResponse.json(
        { error: 'Fee-bump envelopes are not accepted; submit the inner transaction' },
        { status: 400 }
      );
    }

    const tx = envelope as Transaction;
    const sourceAddress =
      typeof tx.source === 'string'
        ? tx.source
        : Address.fromScAddress(tx.source).toString();

    if (sourceAddress !== user.walletContractId) {
      return NextResponse.json(
        { error: 'Transaction source must be the user wallet' },
        { status: 400 }
      );
    }

    const hasSorobanOp = tx.operations.some((op) => op.type === 'invokeHostFunction');
    if (!hasSorobanOp) {
      return NextResponse.json(
        { error: 'Transaction must contain a Soroban operation' },
        { status: 400 }
      );
    }

    const result = await submitSignedTransaction(signedXdr);
    return NextResponse.json({ hash: result.hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Submission failed';
    console.error('Generic submit failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
