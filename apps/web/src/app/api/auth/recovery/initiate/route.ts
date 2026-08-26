import { NextRequest, NextResponse } from 'next/server';
import {
  getUserByEmail,
  isRecoveryLocked,
  setRecoveryInitiated,
} from '@/lib/auth/store';
import { incrementMetric } from '@/lib/metrics';
import {
  countRecentInitiations,
  createRecoveryCodeExpiry,
  generateRecoveryCode,
  isEligibleForRecovery,
  isRecoveryInitiationRateLimited,
  isValidEmail,
} from '@/lib/auth/recovery';

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

    const code = generateRecoveryCode();
    const expiresAt = createRecoveryCodeExpiry();
    await setRecoveryInitiated(normalizedEmail, code, expiresAt);
    await incrementMetric('wallet.recovery.initiated');

    return NextResponse.json({
      email: normalizedEmail,
      code,
      message:
        'Verification code generated. In production this will be sent via email.',
    });
  } catch (err) {
    console.error('Recovery initiation error:', err);
    return NextResponse.json(
      { error: 'Failed to initiate recovery' },
      { status: 500 }
    );
  }
}
