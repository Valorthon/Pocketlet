import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
  setRecoveryPublicKey,
  setRecoveryInitiated,
} from '@/lib/auth/store';
import { RECOVERY_COOKIE_NAME } from '@/lib/auth/recovery-token';

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

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/recovery/verify', {
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
  await setRecoveryPublicKey(email, 'GDDOY5WE2IDQMJS4HIASB5G7GFXMGQ4O4YYT46QETSWAC65JIFBB25KP');
}

describe('POST /api/auth/recovery/verify', () => {
  it('returns 400 when email or code is missing', async () => {
    const req = createRequest({ email: 'alice@example.com' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown user', async () => {
    const req = createRequest({ email: 'unknown@example.com', code: '123456' });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 401 for an invalid code', async () => {
    await makeRecoverableUser('alice@example.com');
    await setRecoveryInitiated('alice@example.com', '123456', new Date(Date.now() + 60000).toISOString());
    const req = createRequest({ email: 'alice@example.com', code: '000000' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('sets a recovery cookie and returns the waiting period on success', async () => {
    await makeRecoverableUser('alice@example.com');
    await setRecoveryInitiated('alice@example.com', '123456', new Date(Date.now() + 60000).toISOString());
    const req = createRequest({ email: 'alice@example.com', code: '123456' });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      email: string;
      verified: boolean;
      readyAfter: string;
      waitingPeriodMs: number;
    };
    expect(body.email).toBe('alice@example.com');
    expect(body.verified).toBe(true);
    expect(body.waitingPeriodMs).toBeGreaterThan(0);
    expect(cookieJar[RECOVERY_COOKIE_NAME]).toBeDefined();
  });
});
