import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { Keypair } from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME, ORIGIN, RP_ID } from '@/lib/auth/config';
import {
  getUserByEmail,
  setCredential,
  setRecoveryPublicKey,
  setWallet,
} from '@/lib/auth/store';
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
  /** Recovery Ed25519 public key (G...) derived from the BIP39 phrase. */
  recoveryPublicKey: string;
}

/**
 * The passkey-kit client generates its own WebAuthn challenge during
 * `createWallet`. We verify the registration response cryptographically and
 * check origin/RPID, but we do not enforce a server-known challenge here.
 * The deploy transaction itself is signed by the passkey and validated on-chain.
 */
async function verifyPasskeyRegistrationResponse(
  response: unknown
): Promise<ReturnType<typeof verifyRegistrationResponse>> {
  return verifyRegistrationResponse({
    response: response as never,
    expectedChallenge: () => true,
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

  const user = getUserByEmail(session.email);
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

  const { response, keyIdBase64, contractId, signedTx, recoveryPublicKey } = body;

  if (!response || !keyIdBase64 || !contractId || !signedTx || !recoveryPublicKey) {
    return NextResponse.json(
      {
        error:
          'response, keyIdBase64, contractId, signedTx, and recoveryPublicKey are required',
      },
      { status: 400 }
    );
  }

  try {
    Keypair.fromPublicKey(recoveryPublicKey);
  } catch {
    return NextResponse.json(
      { error: 'recoveryPublicKey must be a valid Stellar public key' },
      { status: 400 }
    );
  }

  try {
    const verification = await verifyPasskeyRegistrationResponse(response);

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

    setCredential(user.email, {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports ?? undefined,
    });

    const { hash } = await submitSignedTransaction(signedTx);

    setWallet(user.email, {
      walletContractId: contractId,
      stellarAddress: contractId,
      primaryPasskeyKeyId: credential.id,
    });

    setRecoveryPublicKey(user.email, recoveryPublicKey);

    return NextResponse.json({
      email: user.email,
      contractId,
      stellarAddress: contractId,
      hash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Wallet deployment failed';
    console.error('Wallet deployment failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
