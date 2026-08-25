import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { verifySessionToken } from '@/lib/auth/session';
import { getUserByEmail, verifyPinForUser } from '@/lib/auth/store';
import { isPinWellFormed } from '@/lib/auth/pin';

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

  const body = (await request.json()) as { pin?: string };
  const pin = body.pin?.trim();

  if (!pin || !isPinWellFormed(pin)) {
    return NextResponse.json(
      { error: 'PIN must be a 6-digit number' },
      { status: 400 }
    );
  }

  const valid = await verifyPinForUser(user.email, pin);
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 });
  }

  return NextResponse.json({ success: true });
}
