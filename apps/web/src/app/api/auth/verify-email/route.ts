import { NextRequest, NextResponse } from 'next/server';
import { getUserByEmail, setEmailVerified } from '@/lib/auth/store';
import { createSessionToken, cookieOptions } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: string; code?: string };
  const email = body.email?.trim().toLowerCase();
  const code = body.code?.trim();

  if (!email || !code) {
    return NextResponse.json({ error: 'Email and code are required' }, { status: 400 });
  }

  const user = getUserByEmail(email);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (user.verificationCode !== code) {
    return NextResponse.json({ error: 'Invalid verification code' }, { status: 401 });
  }

  setEmailVerified(email);

  const token = await createSessionToken({ email });
  const res = NextResponse.json({ email, verified: true });
  const opts = cookieOptions();
  res.cookies.set(opts.name, token, {
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite,
    domain: opts.domain,
    maxAge: opts.maxAge,
    path: opts.path,
  });
  return res;
}
