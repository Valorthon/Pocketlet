import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Horizon } from '@stellar/stellar-sdk';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail } from '@/lib/auth/store';
import { HORIZON_URL } from '@/lib/wallet/network';
import { getUsdcContractId } from '@/lib/wallet/assets';
import { buildTransactionDetails, TransactionDetails } from '@/lib/wallet/transactions';

export async function GET() {
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
  if (!user || !user.contractId) {
    return NextResponse.json({ error: 'Wallet not deployed' }, { status: 404 });
  }

  const server = new Horizon.Server(HORIZON_URL);
  try {
    const txPage = await server
      .transactions()
      .forAccount(user.contractId)
      .order('desc')
      .limit(20)
      .call();

    const details: TransactionDetails[] = [];
    for (const tx of txPage.records) {
      const ops = await server.operations().forTransaction(tx.hash).call();
      details.push(
        buildTransactionDetails(tx, ops.records, user.contractId, getUsdcContractId())
      );
    }

    return NextResponse.json({ transactions: details });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load transactions';
    console.error('Transaction history lookup failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
