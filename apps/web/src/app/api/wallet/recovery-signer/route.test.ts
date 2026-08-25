import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair, xdr } from '@stellar/stellar-sdk';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
  getUserByEmail,
} from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import {
  parseSorobanTransaction,
  getInvokeContractDetails,
  getInvokeContractArgs,
  submitSignedTransaction,
} from '@/lib/wallet/submit';

let cookieJar: Record<string, string> = {};

const CONTRACT_ID = 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM';
const RECOVERY_PUBLIC_KEY =
  'GDDOY5WE2IDQMJS4HIASB5G7GFXMGQ4O4YYT46QETSWAC65JIFBB25KP';

function buildEd25519SignerScVal(publicKey: string): xdr.ScVal {
  const rawPubKey = Keypair.fromPublicKey(publicKey).rawPublicKey();
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Ed25519'),
    xdr.ScVal.scvBytes(rawPubKey),
    // SignerExpiration(None)
    xdr.ScVal.scvVec([xdr.ScVal.scvVoid()]),
    // SignerLimits(None)
    xdr.ScVal.scvVec([xdr.ScVal.scvVoid()]),
    // SignerStorage::Persistent
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Persistent')]),
  ]);
}

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() => ({
    get: (name: string) =>
      cookieJar[name] ? { value: cookieJar[name], name } : undefined,
    set: (name: string, value: string) => {
      cookieJar[name] = value;
    },
  })),
}));

vi.mock('@/lib/wallet/submit');

beforeEach(() => {
  cookieJar = {};

  vi.mocked(parseSorobanTransaction).mockImplementation(
    () =>
      ({
        operations: [
          {
            type: 'invokeHostFunction',
            func: {} as xdr.HostFunction,
            auth: [],
          },
        ],
      }) as never
  );
  vi.mocked(getInvokeContractDetails).mockReturnValue({
    contractId: CONTRACT_ID,
    functionName: 'add_signer',
  });
  vi.mocked(getInvokeContractArgs).mockReturnValue([
    buildEd25519SignerScVal(RECOVERY_PUBLIC_KEY),
  ]);
  vi.mocked(submitSignedTransaction).mockResolvedValue({
    hash: 'recovery-signer-hash',
  });
});

function createRequest(body: unknown, token?: string) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/recovery-signer', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function createUserWithWallet(email: string) {
  await createUser(email, '000000');
  await setEmailVerified(email);
  await setCredential(email, {
    id: 'primary-key-id',
    publicKey: 'cHVibGljLWtleQ',
    counter: 0,
  });
  await setWallet(email, {
    walletContractId: CONTRACT_ID,
    stellarAddress: CONTRACT_ID,
    primaryPasskeyKeyId: 'primary-key-id',
  });
  return createSessionToken({ email });
}

describe('POST /api/wallet/recovery-signer', () => {
  it('returns 401 without a session cookie', async () => {
    const req = createRequest({
      signedXdr: 'AAAA...',
      recoveryPublicKey: RECOVERY_PUBLIC_KEY,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 404 when the wallet is not deployed', async () => {
    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');
    const token = await createSessionToken({ email: 'alice@example.com' });

    const req = createRequest(
      {
        signedXdr: 'AAAA...',
        recoveryPublicKey: RECOVERY_PUBLIC_KEY,
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('submits the recovery signer and persists recoveryPublicKey on success', async () => {
    const token = await createUserWithWallet('alice@example.com');

    const req = createRequest(
      {
        signedXdr: 'AAAA...',
        recoveryPublicKey: RECOVERY_PUBLIC_KEY,
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      email: string;
      contractId: string;
      recoveryPublicKey: string;
      hash: string;
    };
    expect(body.email).toBe('alice@example.com');
    expect(body.contractId).toBe(CONTRACT_ID);
    expect(body.recoveryPublicKey).toBe(RECOVERY_PUBLIC_KEY);
    expect(body.hash).toBe('recovery-signer-hash');

    const user = await getUserByEmail('alice@example.com');
    expect(user?.recoveryPublicKey).toBe(RECOVERY_PUBLIC_KEY);
  });

  it('returns 400 for an invalid recovery public key', async () => {
    const token = await createUserWithWallet('alice@example.com');

    const req = createRequest(
      {
        signedXdr: 'AAAA...',
        recoveryPublicKey: 'not-a-valid-key',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when the transaction does not call add_signer', async () => {
    const { getInvokeContractDetails } = await import('@/lib/wallet/submit');
    vi.mocked(getInvokeContractDetails).mockReturnValueOnce({
      contractId: CONTRACT_ID,
      functionName: 'transfer',
    });

    const token = await createUserWithWallet('alice@example.com');
    const req = createRequest(
      {
        signedXdr: 'AAAA...',
        recoveryPublicKey: RECOVERY_PUBLIC_KEY,
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when the signed signer does not match the recovery public key', async () => {
    const { getInvokeContractArgs } = await import('@/lib/wallet/submit');
    vi.mocked(getInvokeContractArgs).mockReturnValueOnce([
      buildEd25519SignerScVal(
        'GCHCVLYHMRISIGAYR6HA6LNNMD5OTLLUFKIEZMXEZ4ZPM27SAK5TI46P'
      ),
    ]);

    const token = await createUserWithWallet('alice@example.com');
    const req = createRequest(
      {
        signedXdr: 'AAAA...',
        recoveryPublicKey: RECOVERY_PUBLIC_KEY,
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
