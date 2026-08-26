import { NextRequest, NextResponse } from 'next/server';
import { Horizon } from '@stellar/stellar-sdk';
import { verifyAdminToken } from '@/lib/admin';
import { getAggregateStats } from '@/lib/metrics';
import { getFeePayerKeypair } from '@/lib/wallet/fee-payer';
import { HORIZON_URL } from '@/lib/wallet/network';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (!verifyAdminToken(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await getAggregateStats();

    let feePayerBalance = 'unknown';
    try {
      const feePayer = getFeePayerKeypair();
      const server = new Horizon.Server(HORIZON_URL);
      const account = await server.accounts().accountId(feePayer.publicKey()).call();
      feePayerBalance = account.balances.find((b) => b.asset_type === 'native')?.balance ?? '0';
    } catch {
      // Fee payer balance is best-effort for the dashboard.
    }

    return NextResponse.json({
      ...stats,
      feePayerBalance,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load stats';
    console.error('Admin stats error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
