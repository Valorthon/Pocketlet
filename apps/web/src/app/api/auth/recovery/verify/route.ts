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

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { email?: string; code?: string };
    const { email, code } = body;

    if (!email || !code) {
      return NextResponse.json(
        { error: 'Email and code are required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = getUserByEmail(normalizedEmail);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let updatedUser;
    try {
      updatedUser = verifyRecoveryCode(normalizedEmail, code);
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
