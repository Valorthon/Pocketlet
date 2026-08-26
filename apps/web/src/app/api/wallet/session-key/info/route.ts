import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { verifySessionToken } from '@/lib/auth/session';
import { getUserByEmail } from '@/lib/auth/store';

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
  if (!user || !user.walletContractId || !user.primaryPasskeyKeyId) {
    return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });
  }

  return NextResponse.json({
    walletContractId: user.walletContractId,
    primaryPasskeyKeyId: user.primaryPasskeyKeyId,
  });
}
