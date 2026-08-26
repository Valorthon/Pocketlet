import { Operation } from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail } from '@/lib/auth/store';
import { incrementMetric } from '@/lib/metrics';
import {
  getAuthEntryAddresses,
  hasSourceAccountAuth,
  parseSorobanTransaction,
  submitSignedTransaction,
} from '@/lib/wallet/submit';

export interface SubmitRequest {
  /** Base64-encoded inner Soroban transaction envelope with signed auth entries. */
  signedXdr: string;
}

/**
 * Submit a user-authorized Soroban transaction with the platform fee payer.
 *
 * The endpoint validates that the transaction contains a single
 * invoke_host_function operation and that all address-bound auth entries belong
 * to the logged-in user's wallet. The server then rebuilds the transaction with
 * the fee payer as the source account and submits it directly to RPC.
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

  const user = await getUserByEmail(session.email);
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
    const tx = parseSorobanTransaction(signedXdr);

    if (tx.operations.length !== 1) {
      return NextResponse.json(
        { error: 'Transaction must contain exactly one operation' },
        { status: 400 }
      );
    }

    const op = tx.operations[0];
    if (op.type !== 'invokeHostFunction') {
      return NextResponse.json(
        { error: 'Transaction must contain a Soroban operation' },
        { status: 400 }
      );
    }

    const invokeOp = op as Operation.InvokeHostFunction;

    if (hasSourceAccountAuth(invokeOp)) {
      return NextResponse.json(
        { error: 'Source-account authorization is not supported' },
        { status: 400 }
      );
    }

    const authAddresses = getAuthEntryAddresses(invokeOp);
    if (authAddresses.length === 0) {
      return NextResponse.json(
        { error: 'No wallet authorization entries found' },
        { status: 400 }
      );
    }

    if (authAddresses.some((address) => address !== user.walletContractId)) {
      return NextResponse.json(
        { error: 'Transaction authorization is not for this wallet' },
        { status: 403 }
      );
    }

    const result = await submitSignedTransaction(signedXdr);
    await incrementMetric('wallet.submit.success');
    return NextResponse.json({ hash: result.hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Submission failed';
    console.error('Generic submit failed:', err);
    await incrementMetric('wallet.submit.failure');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
