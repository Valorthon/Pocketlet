import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  Account,
  Contract,
  Keypair,
  TransactionBuilder,
  xdr,
  Address,
} from '@stellar/stellar-sdk';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
} from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUsdcContractId, getXlmContractId } from '@/lib/wallet/assets';
import { NETWORK_PASSPHRASE } from '@/lib/wallet/network';

let dataDir: string;
let cookieJar: Record<string, string> = {};

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() => ({
    get: (name: string) => (cookieJar[name] ? { value: cookieJar[name], name } : undefined),
    set: (name: string, value: string) => {
      cookieJar[name] = value;
    },
  })),
}));

vi.mock('@/lib/wallet/submit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wallet/submit')>();
  return {
    ...actual,
    submitSignedTransaction: vi.fn().mockResolvedValue({ hash: 'session-key-hash-123' }),
  };
});

const WALLET_CONTRACT =
  'CA7FMXWUMM3C37O4QF4E4R4KKXZIEBV7CTFHKDRDXPBLZQ2NMC5PZC5G';
const FEE_PAYER_PUBLIC =
  'GATVJDFPIPADU74ALX4344HEQQZ2LGMNWABPXBOWYMVXM37KMTTUALTU';

function buildSignerStruct(
  publicKey: string,
  store: 'Temporary' | 'Persistent',
  expiration?: number,
  limits?: Map<string, undefined>
): xdr.ScVal {
  const tag = xdr.ScVal.scvSymbol('Ed25519');
  const rawPk = xdr.ScVal.scvBytes(
    Buffer.from(Keypair.fromPublicKey(publicKey).rawPublicKey())
  );

  const expirationVal =
    expiration === undefined
      ? xdr.ScVal.scvVoid()
      : xdr.ScVal.scvU64(BigInt(expiration) as unknown as Parameters<typeof xdr.ScVal.scvU64>[0]);
  const expirationOpt = xdr.ScVal.scvVec([expirationVal]);

  let limitsVal: xdr.ScVal;
  if (!limits) {
    limitsVal = xdr.ScVal.scvVoid();
  } else {
    const entries: xdr.ScMapEntry[] = [];
    for (const [contractId] of limits) {
      entries.push(
        new xdr.ScMapEntry({
          key: new Address(contractId).toScVal(),
          val: xdr.ScVal.scvVoid(),
        })
      );
    }
    limitsVal = xdr.ScVal.scvMap(entries);
  }
  const limitsOpt = xdr.ScVal.scvVec([limitsVal]);

  const storeVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(store)]);

  return xdr.ScVal.scvVec([tag, rawPk, expirationOpt, limitsOpt, storeVal]);
}

function buildAddSignerXdr(
  walletContractId: string,
  publicKey: string,
  store: 'Temporary' | 'Persistent',
  expiration?: number,
  limits?: Map<string, undefined>
): string {
  const source = new Account(FEE_PAYER_PUBLIC, '0');
  const walletContract = new Contract(walletContractId);
  const signerStruct = buildSignerStruct(publicKey, store, expiration, limits);

  const tx = new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(walletContract.call('add_signer', signerStruct))
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-session-key-submit-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
  cookieJar = {};
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
  vi.clearAllMocks();
});

describe('POST /api/wallet/session-key/submit', () => {
  it('returns 401 without a session cookie', async () => {
    const req = new NextRequest('http://localhost/api/wallet/session-key/submit', {
      method: 'POST',
      body: JSON.stringify({ signedXdr: 'abc', publicKey: 'GCHCVLYHMRISIGAYR6HA6LNNMD5OTLLUFKIEZMXEZ4ZPM27SAK5TI46P' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('accepts a valid temporary session key with limits', async () => {
    createUser('alice@example.com', '000000');
    setEmailVerified('alice@example.com');
    setCredential('alice@example.com', { id: 'cred', publicKey: 'base64', counter: 0 });
    setWallet('alice@example.com', {
      walletContractId: WALLET_CONTRACT,
      stellarAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNO',
      primaryPasskeyKeyId: 'key-id',
    });

    const token = await createSessionToken({ email: 'alice@example.com' });
    cookieJar[SESSION_COOKIE_NAME] = token;

    const sessionPublicKey = Keypair.random().publicKey();
    const expiration = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours from now
    const limits = new Map([[getUsdcContractId(), undefined], [getXlmContractId(), undefined]]);

    const signedXdr = buildAddSignerXdr(WALLET_CONTRACT, sessionPublicKey, 'Temporary', expiration, limits);

    const req = new NextRequest('http://localhost/api/wallet/session-key/submit', {
      method: 'POST',
      body: JSON.stringify({ signedXdr, publicKey: sessionPublicKey }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string };
    expect(body.hash).toBe('session-key-hash-123');
  });

  it('rejects a persistent store signer', async () => {
    createUser('bob@example.com', '000000');
    setEmailVerified('bob@example.com');
    setCredential('bob@example.com', { id: 'cred', publicKey: 'base64', counter: 0 });
    setWallet('bob@example.com', {
      walletContractId: WALLET_CONTRACT,
      stellarAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNO',
      primaryPasskeyKeyId: 'key-id',
    });

    const token = await createSessionToken({ email: 'bob@example.com' });
    cookieJar[SESSION_COOKIE_NAME] = token;

    const sessionPublicKey = Keypair.random().publicKey();
    const signedXdr = buildAddSignerXdr(WALLET_CONTRACT, sessionPublicKey, 'Persistent', undefined);

    const req = new NextRequest('http://localhost/api/wallet/session-key/submit', {
      method: 'POST',
      body: JSON.stringify({ signedXdr, publicKey: sessionPublicKey }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Temporary');
  });

  it('rejects unlimited limits', async () => {
    createUser('carol@example.com', '000000');
    setEmailVerified('carol@example.com');
    setCredential('carol@example.com', { id: 'cred', publicKey: 'base64', counter: 0 });
    setWallet('carol@example.com', {
      walletContractId: WALLET_CONTRACT,
      stellarAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNO',
      primaryPasskeyKeyId: 'key-id',
    });

    const token = await createSessionToken({ email: 'carol@example.com' });
    cookieJar[SESSION_COOKIE_NAME] = token;

    const sessionPublicKey = Keypair.random().publicKey();
    const signedXdr = buildAddSignerXdr(WALLET_CONTRACT, sessionPublicKey, 'Temporary', Math.floor(Date.now() / 1000) + 3600, undefined);

    const req = new NextRequest('http://localhost/api/wallet/session-key/submit', {
      method: 'POST',
      body: JSON.stringify({ signedXdr, publicKey: sessionPublicKey }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('limits');
  });

  it('rejects expiration beyond 24 hours', async () => {
    createUser('dave@example.com', '000000');
    setEmailVerified('dave@example.com');
    setCredential('dave@example.com', { id: 'cred', publicKey: 'base64', counter: 0 });
    setWallet('dave@example.com', {
      walletContractId: WALLET_CONTRACT,
      stellarAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNO',
      primaryPasskeyKeyId: 'key-id',
    });

    const token = await createSessionToken({ email: 'dave@example.com' });
    cookieJar[SESSION_COOKIE_NAME] = token;

    const sessionPublicKey = Keypair.random().publicKey();
    const expiration = Math.floor(Date.now() / 1000) + 48 * 60 * 60; // 48 hours
    const limits = new Map([[getUsdcContractId(), undefined]]);

    const signedXdr = buildAddSignerXdr(WALLET_CONTRACT, sessionPublicKey, 'Temporary', expiration, limits);

    const req = new NextRequest('http://localhost/api/wallet/session-key/submit', {
      method: 'POST',
      body: JSON.stringify({ signedXdr, publicKey: sessionPublicKey }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Expiration');
  });
});
