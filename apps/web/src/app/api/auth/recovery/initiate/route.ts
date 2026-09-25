import { NextRequest, NextResponse } from 'next/server';
import {
  getUserByEmail,
  isRecoveryLocked,
  setRecoveryInitiated,
} from '@/lib/auth/store';
import { incrementMetric } from '@/lib/metrics';
import { sendAuthCodeEmail } from '@/lib/mail/auth-codes';
import { enforceAuthCodeRateLimit } from '@/lib/rate-limit';
import {
  countRecentInitiations,
  createRecoveryCodeExpiry,
  generateRecoveryCode,
  isEligibleForRecovery,
  isRecoveryInitiationRateLimited,
  isValidEmail,
} from '@/lib/auth/recovery';

/**
 * Start passkey recovery by emailing a recovery code.
 *
 * The code is never returned (issue #18); it is only in the email and on the
 * user row. `isRecoveryInitiationRateLimited` and the hourly initiation cap
 * below are recovery-specific and stay — they encode a 60-second minimum retry
 * and the initiation-history column. The limiter added here is the general one
 * (issue #121): this is an unauthenticated endpoint that sends mail to an
 * address the caller chose, so it is keyed on that address and the client IP.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { email?: unknown };
    const { email } = body;

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await getUserByEmail(normalizedEmail);

    if (!isEligibleForRecovery(user)) {
      return NextResponse.json(
        { error: 'No recoverable account found for this email' },
        { status: 404 }
      );
    }

    if (await isRecoveryLocked(normalizedEmail)) {
      return NextResponse.json(
        { error: 'Recovery is locked. Try again later.' },
        { status: 429 }
      );
    }

    if (isRecoveryInitiationRateLimited(user)) {
      return NextResponse.json(
        { error: 'Please wait before requesting another recovery code' },
        { status: 429 }
      );
    }

    if (countRecentInitiations(user) >= 5) {
      return NextResponse.json(
        { error: 'Too many recovery attempts. Please try again later.' },
        { status: 429 }
      );
    }

    const limited = await enforceAuthCodeRateLimit(
      req,
      'auth.recovery-initiate',
      normalizedEmail
    );
    if (limited) {
      return limited;
    }

    const code = generateRecoveryCode();
    const expiresAt = createRecoveryCodeExpiry();
    await setRecoveryInitiated(normalizedEmail, code, expiresAt);
    await incrementMetric('wallet.recovery.initiated');

    const delivery = await sendAuthCodeEmail(normalizedEmail, code, 'recovery');
    if (!delivery.ok) {
      // Reported, not swallowed, for the same reason as the other two code
      // routes: without the code the user cannot continue, so "check your
      // email" would be a lie. The cost of retrying is higher here — this
      // initiation is already on the hourly history and the 60-second minimum
      // retry applies — so the message says to wait rather than to retry now.
      console.error(
        `[AUTH] recovery code to ${normalizedEmail} not delivered: ${delivery.provider}: ${delivery.error}`
      );
      return NextResponse.json(
        {
          error:
            'We could not send your recovery code right now. Please try again in a minute.',
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      email: normalizedEmail,
      message: 'Recovery code sent. Check your email.',
    });
  } catch (err) {
    console.error('Recovery initiation error:', err);
    return NextResponse.json(
      { error: 'Failed to initiate recovery' },
      { status: 500 }
    );
  }
}
