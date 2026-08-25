import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Horizon } from '@stellar/stellar-sdk';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail } from '@/lib/auth/store';
import { HORIZON_URL } from '@/lib/wallet/network';
import { getFeePayerKeypair } from '@/lib/wallet/fee-payer';
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

  const user = await getUserByEmail(session.email);
  if (!user || !user.walletContractId) {
    return NextResponse.json({ error: 'Wallet not deployed' }, { status: 404 });
  }

  const server = new Horizon.Server(HORIZON_URL);
  try {
    // Passkey smart wallets are contract addresses (C...), which Horizon's
    // forAccount filter rejects. All user transactions are submitted by the
    // platform fee payer, so we query the fee payer's history and keep only
    // transactions that involve the user's wallet contract.
    const feePayer = getFeePayerKeypair();
    const txPage = await server
      .transactions()
      .forAccount(feePayer.publicKey())
      .order('desc')
      .limit(50)
      .call();

    const usdcContractId = getUsdcContractId();
    const details: TransactionDetails[] = [];
    for (const tx of txPage.records) {
      const ops = await server.operations().forTransaction(tx.hash).call();
      const parsed = buildTransactionDetails(
        tx,
        ops.records,
        user.walletContractId,
        usdcContractId
      );
      if (parsed.type !== 'unknown') {
        details.push(parsed);
      }
    }

    return NextResponse.json({ transactions: details });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load transactions';
    console.error('Transaction history lookup failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
