import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserByEmail, verifyRecoveryCode } from '@/lib/auth/store';
import {
  getReadyAfter,
  getRecoveryWaitingPeriodMs,
} from '@/lib/auth/recovery';
import {
  createRecoveryToken,
  recoveryCookieOptions,
} from '@/lib/auth/recovery-token';
import { enforceAuthVerifyRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Spend a recovery code.
 *
 * Unauthenticated and the highest-stakes code in the app: it opens the flow
 * that re-keys the wallet. `verifyRecoveryCode` compares in constant time and
 * counts wrong guesses atomically against a 3-attempt cap with an hour-long
 * lockout, and this route adds the general per-address and per-IP limit on top
 * of it. The limit is charged before the user lookup, so the 404 below is
 * bounded too.
 */

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { email?: unknown; code?: unknown };
    // Narrowed rather than cast: a JSON number for `code` satisfies a cast and
    // nothing else, and the 400 belongs here rather than deeper in.
    const email = typeof body.email === 'string' ? body.email : undefined;
    const code = typeof body.code === 'string' ? body.code : undefined;

    if (!email || !code) {
      return NextResponse.json(
        { error: 'Email and code are required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    const limited = await enforceAuthVerifyRateLimit(
      req,
      'auth.recovery-verify',
      normalizedEmail
    );
    if (limited) {
      return limited;
    }

    const user = await getUserByEmail(normalizedEmail);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let updatedUser;
    try {
      updatedUser = await verifyRecoveryCode(normalizedEmail, code);
    } catch {
      return NextResponse.json(
        { error: 'Invalid or expired recovery code' },
        { status: 401 }
      );
    }

    const verifiedAt = updatedUser.recoveryVerifiedAt ?? new Date().toISOString();
    const readyAfter = getReadyAfter(verifiedAt).toISOString();
    const waitingPeriodMs = getRecoveryWaitingPeriodMs();
    const token = await createRecoveryToken(normalizedEmail);

    const opts = recoveryCookieOptions();
    const res = NextResponse.json({
      email: normalizedEmail,
      verified: true,
      readyAfter,
      waitingPeriodMs,
    });

    const cookieStore = await cookies();
    cookieStore.set(opts.name, token, {
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      domain: opts.domain,
      maxAge: opts.maxAge,
      path: opts.path,
    });

    return res;
  } catch (err) {
    console.error('Recovery verification error:', err);
    return NextResponse.json(
      { error: 'Failed to verify recovery code' },
      { status: 500 }
    );
  }
}
