import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { Keypair } from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ORIGIN, RP_ID } from '@/lib/auth/config';
import {
  clearRecoveryState,
  getUserByEmail,
  isRecoveryReady,
  setCredential,
  setWallet,
} from '@/lib/auth/store';
import { createSessionToken, cookieOptions } from '@/lib/auth/session';
import {
  RECOVERY_COOKIE_NAME,
  recoveryCookieOptions,
  verifyRecoveryToken,
} from '@/lib/auth/recovery-token';
import { rotateWalletOwner } from '@/lib/wallet/recover';
import { keyStorage } from '@/lib/wallet/keys';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
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
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!isRecoveryReady(payload.email)) {
      return NextResponse.json(
        { error: 'Waiting period has not elapsed' },
        { status: 403 }
      );
    }

    const body = (await req.json()) as { response?: unknown };
    const response = body.response;
    if (!response) {
      return NextResponse.json(
        { error: 'Passkey response is required' },
        { status: 400 }
      );
    }

    if (!user.pendingChallenge) {
      return NextResponse.json(
        { error: 'No pending registration challenge' },
        { status: 400 }
      );
    }

    const verification = await verifyRegistrationResponse({
      response: response as never,
      expectedChallenge: user.pendingChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json(
        { error: 'Passkey verification failed' },
        { status: 401 }
      );
    }

    const newOwnerKeypair = Keypair.random();
    if (!user.contractId) {
      return NextResponse.json(
        { error: 'Wallet not deployed' },
        { status: 500 }
      );
    }

    await rotateWalletOwner(user.contractId, Buffer.from(newOwnerKeypair.rawPublicKey()));

    const credential = verification.registrationInfo.credential;
    setCredential(user.email, {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports ?? undefined,
    });

    keyStorage.store(user.email, newOwnerKeypair.secret());
    setWallet(user.email, {
      contractId: user.contractId,
      stellarAddress: user.contractId,
    });

    clearRecoveryState(user.email);

    const sessionToken = await createSessionToken({ email: user.email });
    const res = NextResponse.json({
      email: user.email,
      verified: true,
      contractId: user.contractId,
    });

    const sessionOpts = cookieOptions();
    res.cookies.set(sessionOpts.name, sessionToken, {
      httpOnly: sessionOpts.httpOnly,
      secure: sessionOpts.secure,
      sameSite: sessionOpts.sameSite,
      domain: sessionOpts.domain,
      maxAge: sessionOpts.maxAge,
      path: sessionOpts.path,
    });

    const recoveryOpts = recoveryCookieOptions();
    res.cookies.set(recoveryOpts.name, '', {
      httpOnly: recoveryOpts.httpOnly,
      secure: recoveryOpts.secure,
      sameSite: recoveryOpts.sameSite,
      domain: recoveryOpts.domain,
      maxAge: 0,
      path: recoveryOpts.path,
    });

    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Recovery failed';
    console.error('Recovery register verify error:', err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
