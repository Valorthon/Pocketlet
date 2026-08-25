import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { verifySessionToken } from '@/lib/auth/session';
import {
  clearPinResetCode,
  getUserByEmail,
  setPin,
  setPinResetCode,
  verifyPinResetCode,
} from '@/lib/auth/store';
import { isPinWellFormed } from '@/lib/auth/pin';

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const body = (await request.json()) as {
    action?: 'request' | 'reset';
    code?: string;
    pin?: string;
  };

  if (body.action === 'request') {
    const code = generateCode();
    await setPinResetCode(user.email, code);
    // Testnet only: return the code so the user can reset without a mail server.
    // In production, send this via email and do not return it in the response.
    return NextResponse.json({
      code,
      message: 'Reset code generated. In production this will be sent via email.',
    });
  }

  if (body.action === 'reset') {
    const { code, pin } = body;
    if (!code || !pin || !isPinWellFormed(pin)) {
      return NextResponse.json(
        { error: 'Valid reset code and 6-digit PIN are required' },
        { status: 400 }
      );
    }

    if (!(await verifyPinResetCode(user.email, code))) {
      return NextResponse.json({ error: 'Invalid reset code' }, { status: 401 });
    }

    await setPin(user.email, pin);
    await clearPinResetCode(user.email);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    { error: 'Action must be "request" or "reset"' },
    { status: 400 }
  );
}
