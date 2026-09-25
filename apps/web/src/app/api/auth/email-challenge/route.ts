import { NextRequest, NextResponse } from 'next/server';
import {
  createUser,
  getUserByEmail,
  setVerificationCode,
} from '@/lib/auth/store';
import { incrementMetric } from '@/lib/metrics';
import { RP_ID } from '@/lib/auth/config';
import { generateVerificationCode } from '@/lib/auth/verification-code';
import { sendAuthCodeEmail } from '@/lib/mail/auth-codes';
import {
  enforceAuthCodeAddressRateLimit,
  enforceAuthCodeIpRateLimit,
} from '@/lib/rate-limit';

/**
 * Start (or restart) signup by emailing a verification code.
 *
 * The code is **never** in the response, on any network (issue #18). It is
 * only ever in the email, which on testnet means the dev server's terminal via
 * `logMailer` — see docs/testing.md.
 *
 * Unauthenticated, so the rate limit is keyed on the submitted address and the
 * client IP (issue #121), and it is charged in two halves. The per-IP windows
 * go **before** the 409 for an already-registered address, because that answer
 * is "this address has a verified Pocketlet wallet" and behind the limiter it
 * was free to ask without bound. The per-address window stays after every
 * validation, immediately before a code is generated and mailed, so a
 * malformed address or somebody else's probe never spends the budget a real
 * user needs for their own signup.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: string };
  const email = body.email?.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  const ipLimited = await enforceAuthCodeIpRateLimit(
    request,
    'auth.email-challenge',
    email
  );
  if (ipLimited) {
    return ipLimited;
  }

  const existing = await getUserByEmail(email);
  if (existing?.emailVerified) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
  }

  const limited = await enforceAuthCodeAddressRateLimit(
    request,
    'auth.email-challenge',
    email
  );
  if (limited) {
    return limited;
  }

  const code = generateVerificationCode();

  // An existing but unverified row is re-issued rather than refused. While the
  // code came back in the response there was nothing to resend; now that it is
  // emailed, expires in 15 minutes and dies after five wrong guesses, a 409
  // here would strand anyone whose mail was slow, filtered or never arrived
  // with an account they can never verify and can never re-create.
  if (existing) {
    await setVerificationCode(email, code);
  } else {
    await createUser(email, code);
  }

  // Mail after the write, never before: the code has to be readable by
  // `verify-email` by the time it can possibly be in someone's inbox.
  const delivery = await sendAuthCodeEmail(email, code, 'signup');
  if (!delivery.ok) {
    // Say so rather than returning 200. The user cannot proceed without the
    // code, so a cheerful "check your email" would send them to a step that
    // can never succeed. The row is left in a state where retrying works —
    // that is what the re-issue branch above is for — so this is safe to
    // surface. It is deliberately not a 500: the write succeeded, only
    // delivery failed.
    console.error(
      `[AUTH] signup code to ${email} not delivered: ${delivery.provider}: ${delivery.error}`
    );
    return NextResponse.json(
      {
        error:
          'We could not send your verification code right now. Please try again in a moment.',
      },
      { status: 502 }
    );
  }

  // Counted here, not next to `createUser`. A signup whose code never arrived
  // is not a completed signup, and this route answers 502 for exactly that.
  if (!existing) {
    await incrementMetric('auth.signup.completed');
  }

  return NextResponse.json({
    email,
    message: 'Verification code sent. Check your email.',
  });
}

export function GET() {
  return NextResponse.json({
    rpId: RP_ID,
    message: 'POST an email to this endpoint to start registration.',
  });
}
