import { Keypair } from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail, createDevice } from '@/lib/auth/store';

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
    publicKey?: string;
    challenge?: string;
    signature?: string;
  };

  const { publicKey, challenge, signature } = body;

  if (!publicKey || !challenge || !signature) {
    return NextResponse.json(
      { error: 'publicKey, challenge, and signature are required' },
      { status: 400 }
    );
  }

  if (!user.pendingChallenge || user.pendingChallenge !== challenge) {
    return NextResponse.json(
      { error: 'Invalid or expired challenge' },
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

  try {
    await createDevice(user.email, publicKey);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to register device';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
