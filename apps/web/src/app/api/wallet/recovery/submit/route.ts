import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ORIGIN, RP_ID } from '@/lib/auth/config';
import {
  clearRecoveryState,
  getUserByEmail,
  isRecoveryLocked,
  setCredential,
  setWallet,
} from '@/lib/auth/store';
import { isWaitingPeriodElapsed } from '@/lib/auth/recovery';
import { createSessionToken, cookieOptions } from '@/lib/auth/session';
import {
  RECOVERY_COOKIE_NAME,
  recoveryCookieOptions,
  verifyRecoveryToken,
} from '@/lib/auth/recovery-token';
import { incrementMetric } from '@/lib/metrics';
import {
  getAuthEntryAddresses,
  getInvokeContractArgs,
  getInvokeContractDetails,
  hasSourceAccountAuth,
  parseSorobanTransaction,
  scValToBytes,
  submitSignedTransaction,
} from '@/lib/wallet/submit';

export interface RecoverySubmitRequest {
  /** Base64-encoded inner Soroban transaction envelope signed by the recovery key. */
  signedXdr: string;
  /** Raw WebAuthn registration response for the new passkey. */
  response: unknown;
  /** Base64URL-encoded credential id of the new passkey. */
  keyIdBase64: string;
}

/**
 * Submit a recovery-signed transaction that adds a new passkey signer to the
 * user's smart wallet.
 *
 * This endpoint is authenticated by the recovery cookie (set after email
 * verification + waiting period), not by a normal session. On success it
 * updates the user's primary credential, starts a normal session, and clears
 * the recovery state.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const recoveryToken = cookieStore.get(RECOVERY_COOKIE_NAME)?.value;
  if (!recoveryToken) {
    return NextResponse.json(
      { error: 'Recovery session not found' },
      { status: 401 }
    );
  }

  const payload = await verifyRecoveryToken(recoveryToken);
  if (!payload) {
    return NextResponse.json(
      { error: 'Invalid recovery session' },
      { status: 401 }
    );
  }

  const user = await getUserByEmail(payload.email);
  if (!user || !user.walletContractId) {
    return NextResponse.json({ error: 'Wallet not deployed' }, { status: 404 });
  }

  if (!user.recoveryVerifiedAt) {
    return NextResponse.json(
      { error: 'Recovery not verified' },
      { status: 403 }
    );
  }

  if (await isRecoveryLocked(payload.email)) {
    return NextResponse.json(
      { error: 'Recovery is locked. Try again later.' },
      { status: 429 }
    );
  }

  if (!isWaitingPeriodElapsed(user.recoveryVerifiedAt)) {
    return NextResponse.json(
      { error: 'Waiting period has not elapsed' },
      { status: 403 }
    );
  }

  let body: RecoverySubmitRequest;
  try {
    body = (await request.json()) as RecoverySubmitRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { signedXdr, response, keyIdBase64 } = body;
  if (!signedXdr || !response || !keyIdBase64) {
    return NextResponse.json(
      { error: 'signedXdr, response, and keyIdBase64 are required' },
      { status: 400 }
    );
  }

  let tx;
  try {
    tx = parseSorobanTransaction(signedXdr);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid transaction';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (tx.operations.length !== 1) {
    return NextResponse.json(
      { error: 'Transaction must contain exactly one operation' },
      { status: 400 }
    );
  }

  const op = tx.operations[0];
  if (op.type !== 'invokeHostFunction') {
    return NextResponse.json(
      { error: 'Transaction must contain a Soroban operation' },
      { status: 400 }
    );
  }

  if (hasSourceAccountAuth(op)) {
    return NextResponse.json(
      { error: 'Source-account authorization is not supported' },
      { status: 400 }
    );
  }

  const authAddresses = getAuthEntryAddresses(op);
  if (authAddresses.length === 0) {
    return NextResponse.json(
      { error: 'No wallet authorization entries found' },
      { status: 400 }
    );
  }

  if (authAddresses.some((address) => address !== user.walletContractId)) {
    return NextResponse.json(
      { error: 'Transaction authorization is not for this wallet' },
      { status: 403 }
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

  const invokeDetails = getInvokeContractDetails(op);
  if (!invokeDetails || invokeDetails.functionName !== 'addSecp256r1') {
    return NextResponse.json(
      { error: 'Transaction must call addSecp256r1' },
      { status: 400 }
    );
  }

  if (invokeDetails.contractId !== user.walletContractId) {
    return NextResponse.json(
      { error: 'Transaction is not for this wallet contract' },
      { status: 403 }
    );
  }

  const invokeArgs = getInvokeContractArgs(op);
  if (!invokeArgs || invokeArgs.length < 2) {
    return NextResponse.json(
      { error: 'addSecp256r1 arguments are malformed' },
      { status: 400 }
    );
  }

  const expectedKeyId = Buffer.from(credential.id, 'base64url');
  const expectedPublicKey = Buffer.from(credential.publicKey);
  const signedKeyId = scValToBytes(invokeArgs[0]);
  const signedPublicKey = scValToBytes(invokeArgs[1]);

  if (!signedKeyId.equals(expectedKeyId) || !signedPublicKey.equals(expectedPublicKey)) {
    return NextResponse.json(
      { error: 'Signed signer does not match the registered passkey' },
      { status: 400 }
    );
  }

  let result;
  try {
    result = await submitSignedTransaction(signedXdr);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transaction submission failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await setCredential(user.email, {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports ?? undefined,
  });

  await setWallet(user.email, {
    walletContractId: user.walletContractId,
    stellarAddress: user.stellarAddress ?? user.walletContractId,
    primaryPasskeyKeyId: credential.id,
  });

  await clearRecoveryState(user.email);
  await incrementMetric('wallet.recovery.completed');

  const sessionToken = await createSessionToken({ email: user.email });

  const sessionOpts = cookieOptions();
  cookieStore.set(sessionOpts.name, sessionToken, {
    httpOnly: sessionOpts.httpOnly,
    secure: sessionOpts.secure,
    sameSite: sessionOpts.sameSite,
    domain: sessionOpts.domain,
    maxAge: sessionOpts.maxAge,
    path: sessionOpts.path,
  });

  const recoveryOpts = recoveryCookieOptions();
  cookieStore.set(recoveryOpts.name, '', {
    httpOnly: recoveryOpts.httpOnly,
    secure: recoveryOpts.secure,
    sameSite: recoveryOpts.sameSite,
    domain: recoveryOpts.domain,
    maxAge: 0,
    path: recoveryOpts.path,
  });

  return NextResponse.json({
    email: user.email,
    verified: true,
    contractId: user.walletContractId,
    hash: result.hash,
  });
}
