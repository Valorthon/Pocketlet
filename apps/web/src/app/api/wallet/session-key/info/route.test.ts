import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
} from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';

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

describe('GET /api/wallet/session-key/info', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns wallet info for an authenticated user', async () => {
    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');
    await setCredential('alice@example.com', {
      id: 'cred-id',
      publicKey: 'base64-pubkey',
      counter: 0,
    });
    await setWallet('alice@example.com', {
      walletContractId: 'CABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNO',
      stellarAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNO',
      primaryPasskeyKeyId: 'key-id-123',
    });

    const token = await createSessionToken({ email: 'alice@example.com' });
    cookieJar[SESSION_COOKIE_NAME] = token;

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      walletContractId: string;
      primaryPasskeyKeyId: string;
    };
    expect(body.walletContractId).toBe('CABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNO');
    expect(body.primaryPasskeyKeyId).toBe('key-id-123');
  });

  it('returns 404 when wallet is not deployed', async () => {
    await createUser('bob@example.com', '000000');
    await setEmailVerified('bob@example.com');

    const token = await createSessionToken({ email: 'bob@example.com' });
    cookieJar[SESSION_COOKIE_NAME] = token;

    const res = await GET();
    expect(res.status).toBe(404);
  });
});
