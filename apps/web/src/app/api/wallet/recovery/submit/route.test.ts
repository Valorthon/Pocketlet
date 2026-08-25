import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { xdr } from '@stellar/stellar-sdk';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
  setRecoveryPublicKey,
  setRecoveryInitiated,
  verifyRecoveryCode,
  getUserByEmail,
} from '@/lib/auth/store';
import {
  createRecoveryToken,
  RECOVERY_COOKIE_NAME,
} from '@/lib/auth/recovery-token';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';

let cookieJar: Record<string, string> = {};

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() => ({
    get: (name: string) =>
      cookieJar[name] ? { value: cookieJar[name], name } : undefined,
    set: (name: string, value: string) => {
      cookieJar[name] = value;
    },
  })),
}));

vi.mock('@simplewebauthn/server', () => ({
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'new-key-id',
        publicKey: Buffer.from('new-public-key'),
        counter: 0,
        transports: [],
      },
    },
  }),
}));

const CONTRACT_ID = 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM';
const NEW_KEY_ID = 'new-key-id';

vi.mock('@/lib/wallet/submit', () => ({
  parseSorobanTransaction: vi.fn().mockImplementation(() => {
    return {
      operations: [
        {
          type: 'invokeHostFunction',
          func: {},
          auth: [],
        },
      ],
    };
  }),
  getInvokeContractDetails: vi.fn().mockReturnValue({
    contractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
    functionName: 'addSecp256r1',
  }),
  getInvokeContractArgs: vi.fn().mockReturnValue([
    { bytes: () => Buffer.from('new-key-id', 'base64url') } as xdr.ScVal,
    { bytes: () => Buffer.from('new-public-key') } as xdr.ScVal,
  ]),
  scValToBytes: vi.fn().mockImplementation((scVal: { bytes: () => Buffer }) => scVal.bytes()),
  getAuthEntryAddresses: vi.fn().mockReturnValue([
    'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
  ]),
  hasSourceAccountAuth: vi.fn().mockReturnValue(false),
  submitSignedTransaction: vi.fn().mockResolvedValue({ hash: 'recovery-tx-hash' }),
}));

beforeEach(() => {
  process.env.RECOVERY_WAITING_PERIOD_MS = '0';
  cookieJar = {};
});

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/wallet/recovery/submit', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function makeRecoverableUser(email: string) {
  await createUser(email, '000000');
  await setEmailVerified(email);
  await setCredential(email, {
    id: 'primary-key-id',
    publicKey: 'cHVibGljLWtleQ',
    counter: 0,
  });
  await setWallet(email, {
    walletContractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
    stellarAddress: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
    primaryPasskeyKeyId: 'primary-key-id',
  });
  await setRecoveryPublicKey(
    email,
    'GDDOY5WE2IDQMJS4HIASB5G7GFXMGQ4O4YYT46QETSWAC65JIFBB25KP'
  );
}

async function setRecoverySession(email: string) {
  const token = await createRecoveryToken(email);
  cookieJar[RECOVERY_COOKIE_NAME] = token;
}

describe('POST /api/wallet/recovery/submit', () => {
  it('returns 401 without a recovery cookie', async () => {
    const req = createRequest({
      signedXdr: 'AAAA...',
      response: { id: 'new-key-id' },
      keyIdBase64: 'new-key-id',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('submits the recovery transaction and starts a session', async () => {
    await makeRecoverableUser('alice@example.com');
    await setRecoveryInitiated(
      'alice@example.com',
      '123456',
      new Date(Date.now() + 60000).toISOString()
    );
    await verifyRecoveryCode('alice@example.com', '123456');
    await setRecoverySession('alice@example.com');

    const req = createRequest({
      signedXdr: 'AAAA...',
      response: { id: 'new-key-id' },
      keyIdBase64: 'new-key-id',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      email: string;
      verified: boolean;
      contractId: string;
      hash: string;
    };
    expect(body.email).toBe('alice@example.com');
    expect(body.verified).toBe(true);
    expect(body.hash).toBe('recovery-tx-hash');

    const user = await getUserByEmail('alice@example.com');
    expect(user?.primaryPasskeyKeyId).toBe('new-key-id');
    expect(user?.credential?.id).toBe('new-key-id');
    expect(cookieJar[SESSION_COOKIE_NAME]).toBeDefined();
    expect(cookieJar[RECOVERY_COOKIE_NAME]).toBe('');
  });

  it('rejects a mismatched keyId', async () => {
    await makeRecoverableUser('alice@example.com');
    await setRecoveryInitiated(
      'alice@example.com',
      '123456',
      new Date(Date.now() + 60000).toISOString()
    );
    await verifyRecoveryCode('alice@example.com', '123456');
    await setRecoverySession('alice@example.com');

    const req = createRequest({
      signedXdr: 'AAAA...',
      response: { id: 'new-key-id' },
      keyIdBase64: 'different-key-id',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects a transaction that does not call addSecp256r1', async () => {
    const { getInvokeContractDetails } = await import('@/lib/wallet/submit');
    vi.mocked(getInvokeContractDetails).mockReturnValueOnce({
      contractId: CONTRACT_ID,
      functionName: 'transfer',
    });

    await makeRecoverableUser('alice@example.com');
    await setRecoveryInitiated(
      'alice@example.com',
      '123456',
      new Date(Date.now() + 60000).toISOString()
    );
    await verifyRecoveryCode('alice@example.com', '123456');
    await setRecoverySession('alice@example.com');

    const req = createRequest({
      signedXdr: 'AAAA...',
      response: { id: NEW_KEY_ID },
      keyIdBase64: NEW_KEY_ID,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects a signed signer that does not match the registered passkey', async () => {
    const { getInvokeContractArgs } = await import('@/lib/wallet/submit');
    vi.mocked(getInvokeContractArgs).mockReturnValueOnce([
      { bytes: () => Buffer.from('attacker-key-id', 'base64url') } as xdr.ScVal,
      { bytes: () => Buffer.from('attacker-public-key') } as xdr.ScVal,
    ]);

    await makeRecoverableUser('alice@example.com');
    await setRecoveryInitiated(
      'alice@example.com',
      '123456',
      new Date(Date.now() + 60000).toISOString()
    );
    await verifyRecoveryCode('alice@example.com', '123456');
    await setRecoverySession('alice@example.com');

    const req = createRequest({
      signedXdr: 'AAAA...',
      response: { id: NEW_KEY_ID },
      keyIdBase64: NEW_KEY_ID,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
