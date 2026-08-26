import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
  setRecoveryPublicKey,
  setRecoveryInitiated,
  verifyRecoveryCode,
} from '@/lib/auth/store';
import { createRecoveryToken, RECOVERY_COOKIE_NAME } from '@/lib/auth/recovery-token';

let cookieJar: Record<string, string> = {};

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() => ({
    get: (name: string) => (cookieJar[name] ? { value: cookieJar[name], name } : undefined),
    set: (name: string, value: string) => {
      cookieJar[name] = value;
    },
  })),
}));

beforeEach(() => {
  cookieJar = {};
});

function createRequest() {
  return new NextRequest('http://localhost/api/auth/recovery/status');
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
  await setRecoveryPublicKey(email, 'GDDOY5WE2IDQMJS4HIASB5G7GFXMGQ4O4YYT46QETSWAC65JIFBB25KP');
}

async function setRecoverySession(email: string) {
  const token = await createRecoveryToken(email);
  cookieJar[RECOVERY_COOKIE_NAME] = token;
}

describe('GET /api/auth/recovery/status', () => {
  it('returns 401 without a recovery cookie', async () => {
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  it('returns pending when the waiting period has not elapsed', async () => {
    await makeRecoverableUser('alice@example.com');
    await setRecoveryInitiated('alice@example.com', '123456', new Date(Date.now() + 60000).toISOString());
    await verifyRecoveryCode('alice@example.com', '123456');
    await setRecoverySession('alice@example.com');

    const res = await GET(createRequest());
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; contractId?: string };
    expect(body.status).toBe('pending');
    expect(body.contractId).toBeUndefined();
  });

  it('returns ready with wallet details when the waiting period has elapsed', async () => {
    process.env.RECOVERY_WAITING_PERIOD_MS = '0';
    await makeRecoverableUser('alice@example.com');
    await setRecoveryInitiated('alice@example.com', '123456', new Date(Date.now() + 60000).toISOString());
    await verifyRecoveryCode('alice@example.com', '123456');
    await setRecoverySession('alice@example.com');

    const res = await GET(createRequest());
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      contractId?: string;
      primaryPasskeyKeyId?: string;
    };
    expect(body.status).toBe('ready');
    expect(body.contractId).toBe('CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM');
    expect(body.primaryPasskeyKeyId).toBe('primary-key-id');
  });
});
