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
import { generateVerificationCode } from '@/lib/auth/verification-code';
import { sendAuthCodeEmail } from '@/lib/mail/auth-codes';
import {
  enforceAuthCodeRateLimit,
  enforceAuthVerifyRateLimit,
} from '@/lib/rate-limit';

/**
 * Request (`action: 'request'`) or spend (`action: 'reset'`) a PIN reset code.
 *
 * The code is emailed and never returned (issue #18), it expires, wrong
 * guesses are capped — atomically, so parallel guesses cannot outrun the cap —
 * and the comparison is constant-time (issue #121). Unlike the other two
 * code-emailing routes this one has a session, so the rate limit keys on the
 * session's own address — but it still keys on the IP too, because one actor
 * with several accounts is exactly what the per-IP window is for.
 *
 * Both actions are limited, and on separate budgets: `request` against the
 * issuing one it shares with the other two mailing routes, `reset` against the
 * guessing one it shares with the other two verifiers. There is no existence
 * check to order around here — the address comes from the session.
 */
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
    code?: unknown;
    pin?: unknown;
  };

  if (body.action === 'request') {
    const limited = await enforceAuthCodeRateLimit(
      request,
      'auth.pin-reset-request',
      user.email
    );
    if (limited) {
      return limited;
    }

    const code = generateVerificationCode();
    await setPinResetCode(user.email, code);

    const delivery = await sendAuthCodeEmail(user.email, code, 'pin-reset');
    if (!delivery.ok) {
      // As in `api/auth/email-challenge`: the user cannot continue without the
      // code, so this reports the failure instead of claiming it was sent.
      // Nothing is left inconsistent — the stored code is simply unused, and
      // asking again overwrites it — so there is no committed write being
      // hidden behind the error.
      console.error(
        `[AUTH] PIN reset code to ${user.email} not delivered: ${delivery.provider}: ${delivery.error}`
      );
      return NextResponse.json(
        {
          error:
            'We could not send your reset code right now. Please try again in a moment.',
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      message: 'Reset code sent. Check your email.',
    });
  }

  if (body.action === 'reset') {
    const { code, pin } = body;
    // `typeof`, not just truthiness. The cast on `body` above is a claim about
    // JSON that arrived over the network, not a check: `{"code": 654321}` is
    // truthy, passed this guard, and reached `createHash().update(code)`,
    // which threw `ERR_INVALID_ARG_TYPE` — an unhandled rejection and a 500
    // where the answer should be a 400. `constantTimeEquals` no longer throws
    // on a non-string either, but the explanation belongs here.
    if (
      typeof code !== 'string' ||
      !code ||
      typeof pin !== 'string' ||
      !isPinWellFormed(pin)
    ) {
      return NextResponse.json(
        { error: 'Valid reset code and 6-digit PIN are required' },
        { status: 400 }
      );
    }

    const limited = await enforceAuthVerifyRateLimit(
      request,
      'auth.pin-reset',
      user.email
    );
    if (limited) {
      return limited;
    }

    const check = await verifyPinResetCode(user.email, code);
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
          { error: 'Reset code expired. Request a new one.' },
          { status: 401 }
        );
      }
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
