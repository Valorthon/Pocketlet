import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME, ORIGIN, RP_ID } from '@/lib/auth/config';
import {
  getUserByEmail,
  setCredential,
  setWallet,
  takePasskeyChallenge,
} from '@/lib/auth/store';
import { incrementMetric } from '@/lib/metrics';
import { submitSignedTransaction } from '@/lib/wallet/submit';

export interface DeployRequest {
  /** Raw WebAuthn registration response from passkey-kit.createWallet. */
  response: unknown;
  /** Base64URL-encoded credential id from passkey-kit.createWallet. */
  keyIdBase64: string;
  /** Deterministic smart-wallet contract address. */
  contractId: string;
  /** Base64 XDR of the authorized deploy carrier, ready for fee-payer submission. */
  signedTx: string;
}

/**
 * Verify a registration response against the challenge this server issued.
 *
 * The client asks `api/wallet/passkey-challenge` for a nonce and passes it to
 * passkey-kit, which puts it in the credential-creation options; the signed
 * response must carry it back. `takePasskeyChallenge` clears the nonce as it
 * reads it, so a captured response cannot be replayed (issue #56).
 */
async function verifyPasskeyRegistrationResponse(
  response: unknown,
  expectedChallenge: string
): Promise<ReturnType<typeof verifyRegistrationResponse>> {
  return verifyRegistrationResponse({
    response: response as never,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: true,
  });
}

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
  if (!user || !user.emailVerified) {
    return NextResponse.json(
      { error: 'User not found or email not verified' },
      { status: 404 }
    );
  }

  if (user.walletContractId) {
    return NextResponse.json({
      email: user.email,
      contractId: user.walletContractId,
      stellarAddress: user.stellarAddress,
    });
  }

  let body: DeployRequest;
  try {
    body = (await request.json()) as DeployRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { response, keyIdBase64, contractId, signedTx } = body;

  if (!response || !keyIdBase64 || !contractId || !signedTx) {
    return NextResponse.json(
      {
        error: 'response, keyIdBase64, contractId, and signedTx are required',
      },
      { status: 400 }
    );
  }

  const expectedChallenge = await takePasskeyChallenge(user.email);
  if (!expectedChallenge) {
    return NextResponse.json(
      { error: 'No pending passkey challenge. Start the ceremony again.' },
      { status: 400 }
    );
  }

  try {
    const verification = await verifyPasskeyRegistrationResponse(
      response,
      expectedChallenge
    );

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json(
        { error: 'Passkey verification failed' },
        { status: 401 }
      );
    }

    const credential = verification.registrationInfo.credential;
    if (credential.id !== keyIdBase64) {
      return NextResponse.json(
        { error: 'Credential id does not match wallet key id' },
        { status: 400 }
      );
    }

    await setCredential(user.email, {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports ?? undefined,
    });

    const { hash } = await submitSignedTransaction(signedTx);

    await setWallet(user.email, {
      walletContractId: contractId,
      stellarAddress: contractId,
      primaryPasskeyKeyId: credential.id,
    });

    await incrementMetric('wallet.deploy.success');

    return NextResponse.json({
      email: user.email,
      contractId,
      stellarAddress: contractId,
      hash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Wallet deployment failed';
    console.error('Wallet deployment failed:', err);
    await incrementMetric('wallet.deploy.failure');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
