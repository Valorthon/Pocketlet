import { Keypair, xdr } from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail, setRecoveryPublicKey } from '@/lib/auth/store';
import {
  getInvokeContractArgs,
  getInvokeContractDetails,
  parseSorobanTransaction,
  submitSignedTransaction,
} from '@/lib/wallet/submit';

export interface RecoverySignerRequest {
  /** Base64 XDR of the wallet's add_signer operation signed by the primary passkey. */
  signedXdr: string;
  /** Recovery Ed25519 public key (G...) derived from the BIP39 phrase. */
  recoveryPublicKey: string;
}

/**
 * Extract the raw Ed25519 public-key bytes from a passkey-kit `Signer` union.
 *
 * passkey-kit's `addEd25519` builds an `add_signer({ signer })` invocation where
 * `signer` is the contract `Signer` union encoded as:
 *
 *   scvVec([
 *     scvSymbol("Ed25519"),
 *     scvBytes(raw_ed25519_pubkey),
 *     ...
 *   ])
 */
function getEd25519PublicKeyBytesFromSignerArg(
  signerArg: xdr.ScVal
): Buffer | null {
  if (signerArg.switch().name !== 'scvVec') {
    return null;
  }

  const vec = signerArg.vec();
  if (!vec || vec.length < 2) {
    return null;
  }

  const tag = vec[0];
  if (tag.switch().name !== 'scvSymbol' || tag.sym().toString() !== 'Ed25519') {
    return null;
  }

  const pubKeyVal = vec[1];
  if (pubKeyVal.switch().name !== 'scvBytes') {
    return null;
  }

  return Buffer.from(pubKeyVal.bytes());
}

/**
 * Compare the first ScVal of an add_signer operation with the expected recovery
 * public key. The first arg is the `Signer` union built by passkey-kit.
 */
function argsMatchRecoveryPublicKey(
  args: ReturnType<typeof getInvokeContractArgs>,
  recoveryPublicKey: string
): boolean {
  if (!args || args.length < 1) {
    return false;
  }

  const firstArg = args[0];
  if (!firstArg) {
    return false;
  }

  const signerPubKey = getEd25519PublicKeyBytesFromSignerArg(firstArg);
  if (!signerPubKey) {
    return false;
  }

  try {
    const expected = Buffer.from(Keypair.fromPublicKey(recoveryPublicKey).rawPublicKey());
    return signerPubKey.equals(expected);
  } catch {
    return false;
  }
}

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

  const user = getUserByEmail(session.email);
  if (!user || !user.walletContractId) {
    return NextResponse.json({ error: 'Wallet not deployed' }, { status: 404 });
  }

  let body: RecoverySignerRequest;
  try {
    body = (await request.json()) as RecoverySignerRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { signedXdr, recoveryPublicKey } = body;
  if (!signedXdr || !recoveryPublicKey) {
    return NextResponse.json(
      { error: 'signedXdr and recoveryPublicKey are required' },
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

  const invokeDetails = getInvokeContractDetails(op);
  if (!invokeDetails || invokeDetails.functionName !== 'add_signer') {
    return NextResponse.json(
      { error: 'Transaction must call add_signer' },
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
  if (!argsMatchRecoveryPublicKey(invokeArgs, recoveryPublicKey)) {
    return NextResponse.json(
      { error: 'Signer public key does not match recoveryPublicKey' },
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

  setRecoveryPublicKey(user.email, recoveryPublicKey);

  return NextResponse.json({
    email: user.email,
    contractId: user.walletContractId,
    recoveryPublicKey,
    hash: result.hash,
  });
}
