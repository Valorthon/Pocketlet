import { NextRequest, NextResponse } from 'next/server';
import { setEmailVerified, verifyEmailVerificationCode } from '@/lib/auth/store';
import { createSessionToken, cookieOptions } from '@/lib/auth/session';
import { enforceAuthVerifyRateLimit } from '@/lib/rate-limit';

/**
 * Exchange the emailed signup code for a session.
 *
 * Since issue #18 the code is a real secret — the only one standing between a
 * caller and a verified account — so the check is no longer a bare `===`.
 * `verifyEmailVerificationCode` enforces the expiry, counts wrong guesses
 * against a cap (atomically, so concurrent guesses cannot outrun it) and
 * compares in constant time (issue #121).
 *
 * This is the guessing surface, so it is rate limited too, on the submitted
 * address and the client IP. The endpoint is unauthenticated; there is no
 * session to key on.
 *
 * There is deliberately no `getUserByEmail` guard here.
 * `verifyEmailVerificationCode` answers `no-code` for an address with no row,
 * which this route already maps to the same 401 as a wrong code — so the
 * lookup only ever cost a query and told an unauthenticated caller whether an
 * address is registered.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: unknown; code?: unknown };
  // Read as unknown and narrow. A cast alone is a claim, not a check: a JSON
  // number reached `code.trim()` and crashed the handler with a 500 where the
  // answer is a 400.
  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined;
  const code = typeof body.code === 'string' ? body.code.trim() : undefined;

  if (!email || !code) {
    return NextResponse.json({ error: 'Email and code are required' }, { status: 400 });
  }

  const limited = await enforceAuthVerifyRateLimit(
    request,
    'auth.verify-email',
    email
  );
  if (limited) {
    return limited;
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
    // 'invalid' and 'no-code' answer alike: whether a code is outstanding —
    // or an account exists at all — is not something an unauthenticated caller
    // needs told.
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
