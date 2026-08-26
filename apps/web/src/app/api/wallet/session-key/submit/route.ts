import { TransactionBuilder, Keypair, Address, xdr } from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail } from '@/lib/auth/store';
import { getUsdcContractId, getXlmContractId } from '@/lib/wallet/assets';
import {
  getInvokeContractDetails,
  getInvokeContractArgs,
  submitSignedTransaction,
} from '@/lib/wallet/submit';
import { NETWORK_PASSPHRASE } from '@/lib/wallet/network';

const MAX_EXPIRATION_SECONDS = 24 * 60 * 60;
const MS_THRESHOLD = 10_000_000_000; // above this treat as milliseconds

export interface SessionKeySubmitRequest {
  signedXdr: string;
  publicKey: string;
}

class SessionKeyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionKeyValidationError';
  }
}

function parseSignerArg(scVal: xdr.ScVal): {
  tag: string;
  rawPublicKey: Buffer;
  expiration: number | null;
  limits: xdr.ScVal | null;
  store: string;
} | null {
  if (scVal.switch().name !== 'scvVec') {
    return null;
  }
  const vec = scVal.vec();
  if (!vec || vec.length !== 5) {
    return null;
  }

  const tag = vec[0].sym()?.toString();
  if (tag !== 'Ed25519') {
    return null;
  }

  const rawPublicKey = Buffer.from(vec[1].bytes());
  if (rawPublicKey.length !== 32) {
    return null;
  }

  const expirationVec = vec[2].vec();
  if (!expirationVec || expirationVec.length !== 1) {
    return null;
  }
  const expirationInner = expirationVec[0];
  const expiration =
    expirationInner.switch().name === 'scvVoid'
      ? null
      : Number(expirationInner.u64());

  const limitsVec = vec[3].vec();
  if (!limitsVec || limitsVec.length !== 1) {
    return null;
  }
  const limitsInner = limitsVec[0];
  const limits =
    limitsInner.switch().name === 'scvVoid' ? null : limitsInner;

  const storeVec = vec[4].vec();
  if (!storeVec || storeVec.length !== 1) {
    return null;
  }
  const store = storeVec[0].sym()?.toString();
  if (store !== 'Temporary' && store !== 'Persistent') {
    return null;
  }

  return { tag, rawPublicKey, expiration, limits, store };
}

function validateContractIdInLimits(limits: xdr.ScVal): boolean {
  if (limits.switch().name !== 'scvMap') {
    return false;
  }
  const map = limits.map();
  if (!map) {
    return true;
  }

  const allowed = new Set([getUsdcContractId(), getXlmContractId()]);

  for (const entry of map) {
    const key = entry.key();
    if (key.switch().name !== 'scvAddress') {
      return false;
    }
    const contractId = Address.fromScVal(key).toString();
    if (!allowed.has(contractId)) {
      return false;
    }
    // Value must be Void (unrestricted on this contract)
    const val = entry.val();
    if (val.switch().name !== 'scvVoid') {
      return false;
    }
  }

  return true;
}

function validateAddSignerXdr(
  signedXdr: string,
  walletContractId: string,
  expectedPublicKey: string
): void {
  const envelope = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

  if (envelope.operations.length !== 1) {
    throw new SessionKeyValidationError('Transaction must contain exactly one operation');
  }

  const op = envelope.operations[0];
  if (!op) {
    throw new SessionKeyValidationError('Transaction contains no operations');
  }

  const details = getInvokeContractDetails(op);
  if (!details) {
    throw new SessionKeyValidationError('Transaction does not invoke a contract');
  }

  if (details.contractId !== walletContractId) {
    throw new SessionKeyValidationError('Transaction invokes the wrong contract');
  }

  if (details.functionName !== 'add_signer') {
    throw new SessionKeyValidationError('Transaction must call add_signer');
  }

  const args = getInvokeContractArgs(op);
  if (!args || args.length !== 1) {
    throw new SessionKeyValidationError('add_signer arguments are malformed');
  }

  const parsed = parseSignerArg(args[0]);
  if (!parsed) {
    throw new SessionKeyValidationError('Could not parse signer argument');
  }

  const expectedRawPk = Buffer.from(Keypair.fromPublicKey(expectedPublicKey).rawPublicKey());
  if (!parsed.rawPublicKey.equals(expectedRawPk)) {
    throw new SessionKeyValidationError('Signer public key does not match expected value');
  }

  if (parsed.store !== 'Temporary') {
    throw new SessionKeyValidationError('Session signer must use Temporary storage');
  }

  if (parsed.expiration === null) {
    throw new SessionKeyValidationError('Session signer must have an expiration');
  }

  const expNum = Number(parsed.expiration);
  const nowMs = Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);

  let expirationSeconds: number;
  if (expNum > MS_THRESHOLD) {
    expirationSeconds = Math.floor(expNum / 1000);
  } else {
    expirationSeconds = expNum;
  }

  if (expirationSeconds > nowSeconds + MAX_EXPIRATION_SECONDS + 300) {
    throw new SessionKeyValidationError('Expiration exceeds maximum allowed duration');
  }

  if (parsed.limits === null) {
    throw new SessionKeyValidationError('Session signer must have contract limits');
  }

  if (!validateContractIdInLimits(parsed.limits)) {
    throw new SessionKeyValidationError('Signer limits contain disallowed contracts');
  }
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
  if (!user || !user.walletContractId) {
    return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });
  }

  let body: SessionKeySubmitRequest;
  try {
    body = (await request.json()) as SessionKeySubmitRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { signedXdr, publicKey } = body;

  if (!signedXdr || typeof signedXdr !== 'string') {
    return NextResponse.json({ error: 'signedXdr is required' }, { status: 400 });
  }

  if (!publicKey || typeof publicKey !== 'string') {
    return NextResponse.json({ error: 'publicKey is required' }, { status: 400 });
  }

  try {
    validateAddSignerXdr(signedXdr, user.walletContractId, publicKey);
    const result = await submitSignedTransaction(signedXdr);
    return NextResponse.json({ hash: result.hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Session key authorization failed';
    console.error('Session key submit failed:', err);
    const status = err instanceof SessionKeyValidationError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
