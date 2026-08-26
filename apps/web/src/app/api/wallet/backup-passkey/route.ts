import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME, ORIGIN, RP_ID } from '@/lib/auth/config';
import { getUserByEmail, setBackupPasskey } from '@/lib/auth/store';

export interface BackupPasskeyRequest {
  /** Base64URL-encoded credential id of the backup passkey. */
  keyIdBase64: string;
  /** Raw WebAuthn registration response for the backup passkey. */
  response: unknown;
}

/**
 * Record that the user has registered a backup passkey.
 *
 * The on-chain signer registration is performed client-side with the primary
 * passkey; this endpoint verifies the WebAuthn registration response and
 * persists the backup credential so it can be used for login later.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
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
  if (!user || !user.walletContractId) {
    return NextResponse.json({ error: 'Wallet not deployed' }, { status: 404 });
  }

  let body: BackupPasskeyRequest;
  try {
    body = (await request.json()) as BackupPasskeyRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { keyIdBase64, response } = body;
  if (!keyIdBase64 || !response) {
    return NextResponse.json(
      { error: 'keyIdBase64 and response are required' },
      { status: 400 }
    );
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: response as never,
      // V1 testnet shortcut: passkey-kit generates the challenge client-side.
      // TODO(V1 production): bind the challenge to a server-generated nonce.
      expectedChallenge: () => true,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Passkey verification failed';
    return NextResponse.json({ error: message }, { status: 401 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json(
      { error: 'Passkey verification failed' },
      { status: 401 }
    );
  }

  const credential = verification.registrationInfo.credential;
  if (credential.id !== keyIdBase64) {
    return NextResponse.json(
      { error: 'Credential id does not match request' },
      { status: 400 }
    );
  }

  await setBackupPasskey(user.email, {
    credential: {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports ?? undefined,
    },
  });

  return NextResponse.json({ success: true });
}
