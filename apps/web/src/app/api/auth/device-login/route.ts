import { Keypair } from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import {
  getUserByEmail,
  getDeviceByPublicKey,
  updateDeviceLastUsed,
} from '@/lib/auth/store';
import { incrementMetric } from '@/lib/metrics';
import { createSessionToken, cookieOptions } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    email?: string;
    challenge?: string;
    signature?: string;
    publicKey?: string;
  };

  const email = body.email?.trim().toLowerCase();
  const challenge = body.challenge;
  const signature = body.signature;
  const publicKey = body.publicKey;

  if (!email || !challenge || !signature || !publicKey) {
    return NextResponse.json(
      { error: 'Email, challenge, signature, and publicKey are required' },
      { status: 400 }
    );
  }

  const user = await getUserByEmail(email);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (!user.pendingChallenge || user.pendingChallenge !== challenge) {
    return NextResponse.json(
      { error: 'Invalid or expired challenge' },
      { status: 401 }
    );
  }

  const device = await getDeviceByPublicKey(publicKey);
  if (!device || device.email !== email) {
    return NextResponse.json(
      { error: 'Device not recognized' },
      { status: 401 }
    );
  }

  if (new Date(device.expiresAt).getTime() <= Date.now()) {
    return NextResponse.json(
      { error: 'Device key expired. Please log in with your passkey or recovery phrase.' },
      { status: 401 }
    );
  }

  try {
    const kp = Keypair.fromPublicKey(publicKey);
    const challengeBuffer = Buffer.from(challenge, 'base64');
    const signatureBuffer = Buffer.from(signature, 'base64');
    const valid = kp.verify(challengeBuffer, signatureBuffer);

    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Signature verification failed' },
      { status: 401 }
    );
  }

  await updateDeviceLastUsed(device.id);
  await incrementMetric('auth.login.device');

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
}
