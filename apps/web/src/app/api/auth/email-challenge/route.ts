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
import { enforceAuthCodeRateLimit } from '@/lib/rate-limit';

/**
 * Start (or restart) signup by emailing a verification code.
 *
 * The code is **never** in the response, on any network (issue #18). It is
 * only ever in the email, which on testnet means the dev server's terminal via
 * `logMailer` — see docs/testing.md.
 *
 * Unauthenticated, so the rate limit is keyed on the submitted address and the
 * client IP (issue #121). It is charged only once every validation has passed,
 * immediately before a code is generated and mailed.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: string };
  const email = body.email?.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  const existing = await getUserByEmail(email);
  if (existing?.emailVerified) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
  }

  const limited = await enforceAuthCodeRateLimit(
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
    await incrementMetric('auth.signup.completed');
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
