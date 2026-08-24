import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserByEmail, isRecoveryLocked } from '@/lib/auth/store';
import {
  getReadyAfter,
  getRecoveryWaitingPeriodMs,
  isWaitingPeriodElapsed,
} from '@/lib/auth/recovery';
import {
  RECOVERY_COOKIE_NAME,
  verifyRecoveryToken,
} from '@/lib/auth/recovery-token';

export const dynamic = 'force-dynamic';

export async function GET(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _req: NextRequest
): Promise<NextResponse> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(RECOVERY_COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json(
        { error: 'Recovery session not found' },
        { status: 401 }
      );
    }

    const payload = await verifyRecoveryToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'Invalid recovery session' },
        { status: 401 }
      );
    }

    const user = getUserByEmail(payload.email);
    if (!user?.recoveryVerifiedAt) {
      return NextResponse.json(
        { error: 'Recovery not verified' },
        { status: 401 }
      );
    }

    if (isRecoveryLocked(payload.email)) {
      return NextResponse.json(
        { error: 'Recovery is locked. Try again later.' },
        { status: 429 }
      );
    }

    const ready = isWaitingPeriodElapsed(user.recoveryVerifiedAt);
    const readyAfter = getReadyAfter(user.recoveryVerifiedAt).toISOString();
    const waitingPeriodMs = getRecoveryWaitingPeriodMs();

    return NextResponse.json({
      email: payload.email,
      status: ready ? 'ready' : 'pending',
      readyAfter,
      waitingPeriodMs,
      contractId: ready ? user.walletContractId : undefined,
      primaryPasskeyKeyId: ready ? user.primaryPasskeyKeyId : undefined,
    });
  } catch (err) {
    console.error('Recovery status error:', err);
    return NextResponse.json(
      { error: 'Failed to check recovery status' },
      { status: 500 }
    );
  }
}
