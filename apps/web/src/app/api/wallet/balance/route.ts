import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail } from '@/lib/auth/store';
import { getTokenBalance } from '@/lib/wallet/token';
import { getXlmContractId, getUsdcContractId } from '@/lib/wallet/assets';

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

  try {
    const [xlmBalance, usdcBalance] = await Promise.all([
      getTokenBalance(getXlmContractId(), user.walletContractId),
      getTokenBalance(getUsdcContractId(), user.walletContractId),
    ]);

    return NextResponse.json({
      xlm: xlmBalance.toString(),
      usdc: usdcBalance.toString(),
      contractId: user.walletContractId,
      stellarAddress: user.stellarAddress,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Balance lookup failed';
    console.error('Balance lookup failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
