import { NextRequest, NextResponse } from 'next/server';
import {
  getUserByEmail,
  isRecoveryLocked,
  rollbackRecoveryInitiation,
  setRecoveryInitiated,
} from '@/lib/auth/store';
import { incrementMetric } from '@/lib/metrics';
import { sendAuthCodeEmail } from '@/lib/mail/auth-codes';
import {
  enforceAuthCodeAddressRateLimit,
  enforceAuthCodeIpRateLimit,
} from '@/lib/rate-limit';
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
 *
 * Its per-IP half is charged **before** the 404 for an address with no
 * recoverable account, which is otherwise a free "does this person have a
 * Pocketlet wallet?" oracle; the per-address half stays after every check, so
 * a stranger probing a victim's address cannot spend the budget that victim
 * needs to recover.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { email?: unknown };
    const { email } = body;

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const ipLimited = await enforceAuthCodeIpRateLimit(
      req,
      'auth.recovery-initiate',
      normalizedEmail
    );
    if (ipLimited) {
      return ipLimited;
    }

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

    const limited = await enforceAuthCodeAddressRateLimit(
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
      // email" would be a lie.
      //
      // Give the hourly initiation back first. The initiation has to be
      // recorded before the mail is attempted, so without this a five-minute
      // provider outage spends all five of the user's hourly initiations on
      // codes that never arrived and locks them out of recovery for an hour —
      // after five "try again in a minute" responses. The 60-second retry
      // floor is left in place, which is what the message refers to.
      await rollbackRecoveryInitiation(normalizedEmail);
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
