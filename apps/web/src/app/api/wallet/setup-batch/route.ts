import { Keypair, xdr, Address } from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import {
  getUserByEmail,
  setRecoveryPublicKey,
  createDevice,
} from '@/lib/auth/store';
import {
  getInvokeContractArgs,
  getInvokeContractDetails,
  parseSorobanTransaction,
  submitSignedTransaction,
} from '@/lib/wallet/submit';

export interface SetupBatchRequest {
  recoveryXdr: string;
  deviceXdr: string;
  recoveryPublicKey: string;
}

/**
 * Extract the raw Ed25519 public-key bytes from a passkey-kit `Signer` union.
 */
function getEd25519PublicKeyBytesFromSignerArg(signerArg: xdr.ScVal): Buffer | null {
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

function argsMatchRecoveryPublicKey(
  args: ReturnType<typeof getInvokeContractArgs>,
  recoveryPublicKey: string
): boolean {
  if (!args || args.length < 1) return false;
  const firstArg = args[0];
  if (!firstArg) return false;
  const signerPubKey = getEd25519PublicKeyBytesFromSignerArg(firstArg);
  if (!signerPubKey) return false;
  try {
    const expected = Buffer.from(Keypair.fromPublicKey(recoveryPublicKey).rawPublicKey());
    return signerPubKey.equals(expected);
  } catch {
    return false;
  }
}

function parseSignerArg(
  scVal: xdr.ScVal
): {
  tag: string;
  rawPublicKey: Buffer;
  expiration: number | null;
  limits: xdr.ScVal | null;
  store: string;
} | null {
  if (scVal.switch().name !== 'scvVec') return null;
  const vec = scVal.vec();
  if (!vec || vec.length !== 5) return null;

  const tag = vec[0].sym()?.toString();
  if (tag !== 'Ed25519') return null;

  const rawPublicKey = Buffer.from(vec[1].bytes());
  if (rawPublicKey.length !== 32) return null;

  const expirationVec = vec[2].vec();
  if (!expirationVec || expirationVec.length !== 1) return null;
  const expirationInner = expirationVec[0];
  const expiration =
    expirationInner.switch().name === 'scvVoid' ? null : Number(expirationInner.u64());

  const limitsVec = vec[3].vec();
  if (!limitsVec || limitsVec.length !== 1) return null;
  const limitsInner = limitsVec[0];
  const limits = limitsInner.switch().name === 'scvVoid' ? null : limitsInner;

  const storeVec = vec[4].vec();
  if (!storeVec || storeVec.length !== 1) return null;
  const store = storeVec[0].sym()?.toString();
  if (store !== 'Temporary' && store !== 'Persistent') return null;

  return { tag, rawPublicKey, expiration, limits, store };
}

function validateContractIdInLimits(limits: xdr.ScVal): boolean {
  if (limits.switch().name !== 'scvMap') return false;
  const map = limits.map();
  if (!map) return true;

  const allowed = new Set([
    process.env.NEXT_PUBLIC_USDC_CONTRACT_ID ?? '',
    process.env.NEXT_PUBLIC_XLM_CONTRACT_ID ?? '',
  ]);

  for (const entry of map) {
    const key = entry.key();
    if (key.switch().name !== 'scvAddress') return false;
    const contractId = Address.fromScVal(key).toString();
    if (!allowed.has(contractId)) return false;
    const val = entry.val();
    if (val.switch().name !== 'scvVoid') return false;
  }
  return true;
}

const MAX_EXPIRATION_SECONDS = 90 * 24 * 60 * 60;
const MS_THRESHOLD = 10_000_000_000;

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function validateRecoveryXdr(signedXdr: string, walletContractId: string, expectedPublicKey: string) {
  const tx = parseSorobanTransaction(signedXdr);
  if (tx.operations.length !== 1) {
    throw new ValidationError('Recovery transaction must contain exactly one operation');
  }
  const op = tx.operations[0];
  if (op.type !== 'invokeHostFunction') {
    throw new ValidationError('Recovery transaction must be a Soroban operation');
  }
  const details = getInvokeContractDetails(op);
  if (!details || details.functionName !== 'add_signer') {
    throw new ValidationError('Recovery transaction must call add_signer');
  }
  if (details.contractId !== walletContractId) {
    throw new ValidationError('Recovery transaction invokes the wrong contract');
  }
  const args = getInvokeContractArgs(op);
  if (!argsMatchRecoveryPublicKey(args, expectedPublicKey)) {
    throw new ValidationError('Recovery signer public key does not match');
  }
}

function validateDeviceXdr(signedXdr: string, walletContractId: string) {
  const tx = parseSorobanTransaction(signedXdr);
  if (tx.operations.length !== 1) {
    throw new ValidationError('Device transaction must contain exactly one operation');
  }
  const op = tx.operations[0];
  if (op.type !== 'invokeHostFunction') {
    throw new ValidationError('Device transaction must be a Soroban operation');
  }
  const details = getInvokeContractDetails(op);
  if (!details || details.functionName !== 'add_signer') {
    throw new ValidationError('Device transaction must call add_signer');
  }
  if (details.contractId !== walletContractId) {
    throw new ValidationError('Device transaction invokes the wrong contract');
  }

  const args = getInvokeContractArgs(op);
  if (!args || args.length !== 1) {
    throw new ValidationError('Device add_signer arguments are malformed');
  }
  const parsed = parseSignerArg(args[0]);
  if (!parsed) {
    throw new ValidationError('Could not parse device signer argument');
  }
  if (parsed.store !== 'Temporary') {
    throw new ValidationError('Device signer must use Temporary storage');
  }
  if (parsed.expiration === null) {
    throw new ValidationError('Device signer must have an expiration');
  }
  const expNum = Number(parsed.expiration);
  const nowSeconds = Math.floor(Date.now() / 1000);
  let expirationSeconds: number;
  if (expNum > MS_THRESHOLD) {
    expirationSeconds = Math.floor(expNum / 1000);
  } else {
    expirationSeconds = expNum;
  }
  if (expirationSeconds > nowSeconds + MAX_EXPIRATION_SECONDS + 300) {
    throw new ValidationError('Device expiration exceeds maximum allowed duration');
  }
  if (parsed.limits === null) {
    throw new ValidationError('Device signer must have contract limits');
  }
  if (!validateContractIdInLimits(parsed.limits)) {
    throw new ValidationError('Device signer limits contain disallowed contracts');
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

  const user = await getUserByEmail(session.email);
  if (!user || !user.walletContractId) {
    return NextResponse.json({ error: 'Wallet not deployed' }, { status: 404 });
  }

  let body: SetupBatchRequest;
  try {
    body = (await request.json()) as SetupBatchRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { recoveryXdr, deviceXdr, recoveryPublicKey } = body;
  if (!recoveryXdr || !deviceXdr || !recoveryPublicKey) {
    return NextResponse.json(
      { error: 'recoveryXdr, deviceXdr, and recoveryPublicKey are required' },
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
    validateRecoveryXdr(recoveryXdr, user.walletContractId, recoveryPublicKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid recovery transaction';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    validateDeviceXdr(deviceXdr, user.walletContractId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid device transaction';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // 1. Submit recovery tx and wait for confirmation
  let recoveryResult: { hash: string };
  try {
    recoveryResult = await submitSignedTransaction(recoveryXdr);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Recovery transaction submission failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // 2. Submit device tx (recovery signer is now registered)
  let deviceResult: { hash: string };
  try {
    deviceResult = await submitSignedTransaction(deviceXdr);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Device transaction submission failed';
    return NextResponse.json(
      { error: message, recoveryHash: recoveryResult.hash },
      { status: 500 }
    );
  }

  // 3. Update DB
  try {
    await setRecoveryPublicKey(user.email, recoveryPublicKey);

    // Extract device public key from device tx for DB record
    const deviceTx = parseSorobanTransaction(deviceXdr);
    const deviceOp = deviceTx.operations[0];
    const deviceArgs = getInvokeContractArgs(deviceOp);
    const parsedDevice = deviceArgs ? parseSignerArg(deviceArgs[0]) : null;
    if (parsedDevice) {
      await createDevice(user.email, Keypair.fromRawEd25519Seed(parsedDevice.rawPublicKey).publicKey());
    }
  } catch (err) {
    console.error('DB update failed after batch setup:', err);
    // Non-fatal: user can retry from profile
  }

  return NextResponse.json({
    recoveryHash: recoveryResult.hash,
    deviceHash: deviceResult.hash,
  });
}
