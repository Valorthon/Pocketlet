import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Horizon } from '@stellar/stellar-sdk';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail } from '@/lib/auth/store';
import { HORIZON_URL } from '@/lib/wallet/network';
import { getUsdcContractId } from '@/lib/wallet/assets';
import { buildTransactionDetails } from '@/lib/wallet/transactions';

export async function GET(request: NextRequest) {
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

  const { searchParams } = new URL(request.url);
  const hash = searchParams.get('hash');
  if (!hash) {
    return NextResponse.json({ error: 'Transaction hash is required' }, { status: 400 });
  }

  const server = new Horizon.Server(HORIZON_URL);
  try {
    const tx = await server.transactions().transaction(hash).call();
    const ops = await server.operations().forTransaction(hash).call();
    const details = buildTransactionDetails(tx, ops.records, user.walletContractId, getUsdcContractId());
    return NextResponse.json(details);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load transaction details';
    console.error('Transaction details lookup failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
