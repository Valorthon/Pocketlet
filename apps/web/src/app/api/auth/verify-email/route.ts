import { NextRequest, NextResponse } from 'next/server';
import {
  getUserByEmail,
  setEmailVerified,
  verifyEmailVerificationCode,
} from '@/lib/auth/store';
import { createSessionToken, cookieOptions } from '@/lib/auth/session';

/**
 * Exchange the emailed signup code for a session.
 *
 * Since issue #18 the code is a real secret — the only one standing between a
 * caller and a verified account — so the check is no longer a bare `===`.
 * `verifyEmailVerificationCode` enforces the expiry, counts wrong guesses
 * against a cap and compares in constant time (issue #121).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: string; code?: string };
  const email = body.email?.trim().toLowerCase();
  const code = body.code?.trim();

  if (!email || !code) {
    return NextResponse.json({ error: 'Email and code are required' }, { status: 400 });
  }

  const user = await getUserByEmail(email);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const check = await verifyEmailVerificationCode(email, code);
  if (!check.ok) {
    if (check.reason === 'too-many-attempts') {
      return NextResponse.json(
        {
          error:
            'Too many incorrect codes. That code is no longer valid — request a new one.',
        },
        { status: 429 }
      );
    }
    if (check.reason === 'expired') {
      return NextResponse.json(
        { error: 'Verification code expired. Request a new one.' },
        { status: 401 }
      );
    }
    // 'invalid' and 'no-code' answer alike: whether a code is outstanding is
    // not something an unauthenticated caller needs told.
    return NextResponse.json({ error: 'Invalid verification code' }, { status: 401 });
  }

  await setEmailVerified(email);

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
