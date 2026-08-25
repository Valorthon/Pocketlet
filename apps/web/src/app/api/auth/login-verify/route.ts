import {
  verifyAuthenticationResponse,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser';
import { NextRequest, NextResponse } from 'next/server';
import { ORIGIN, RP_ID } from '@/lib/auth/config';
import {
  getUserByEmail,
  updateCredentialCounter,
  updateBackupCredentialCounter,
} from '@/lib/auth/store';
import { incrementMetric } from '@/lib/metrics';
import { createSessionToken, cookieOptions } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    email?: string;
    response?: unknown;
  };
  const email = body.email?.trim().toLowerCase();
  const response = body.response as AuthenticationResponseJSON | undefined;

  if (!email || !response) {
    return NextResponse.json(
      { error: 'Email and passkey response are required' },
      { status: 400 }
    );
  }

  const user = await getUserByEmail(email);
  if (!user || !user.credential) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (!user.pendingChallenge) {
    return NextResponse.json(
      { error: 'No pending authentication challenge' },
      { status: 400 }
    );
  }

  const responseId = response.id;
  const isBackup =
    user.hasBackupPasskey &&
    user.backupCredential &&
    user.backupCredential.id === responseId;

  const storedCredential = isBackup ? user.backupCredential : user.credential;
  if (!storedCredential || storedCredential.id !== responseId) {
    return NextResponse.json(
      { error: 'Passkey not recognized' },
      { status: 401 }
    );
  }

  try {
    const credential = {
      id: storedCredential.id,
      publicKey: Buffer.from(storedCredential.publicKey, 'base64url'),
      counter: storedCredential.counter,
      transports: storedCredential.transports as AuthenticatorTransportFuture[] | undefined,
    };

    const verification = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge: user.pendingChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential,
    });

    if (!verification.verified || !verification.authenticationInfo) {
      return NextResponse.json(
        { error: 'Passkey verification failed' },
        { status: 401 }
      );
    }

    if (isBackup) {
      await updateBackupCredentialCounter(
        email,
        verification.authenticationInfo.newCounter
      );
    } else {
      await updateCredentialCounter(email, verification.authenticationInfo.newCounter);
    }

    await incrementMetric('auth.login.completed');

    const token = await createSessionToken({ email });
    const res = NextResponse.json({ email, verified: true });
    const opts = cookieOptions();
    res.cookies.set(opts.name, token, {
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      domain: opts.domain,
      maxAge: opts.maxAge,
      path: opts.path,
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
