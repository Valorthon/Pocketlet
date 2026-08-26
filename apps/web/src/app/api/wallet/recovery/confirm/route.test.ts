import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  setWallet,
  setRecoveryPublicKey,
  getUserByEmail,
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

async function createConfirmedSession(email: string) {
  await createUser(email, '000000');
  await setEmailVerified(email);
  await setWallet(email, {
    walletContractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
    stellarAddress: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
    primaryPasskeyKeyId: 'test-key-id',
  });
  await setRecoveryPublicKey(
    email,
    'GDDOY5WE2IDQMJS4HIASB5G7GFXMGQ4O4YYT46QETSWAC65JIFBB25KP'
  );
  return createSessionToken({ email });
}

describe('POST /api/wallet/recovery/confirm', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('marks the recovery phrase as confirmed', async () => {
    const token = await createConfirmedSession('alice@example.com');
    cookieJar[SESSION_COOKIE_NAME] = token;

    const res = await POST();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { confirmed: boolean };
    expect(body.confirmed).toBe(true);

    const user = await getUserByEmail('alice@example.com');
    expect(user?.recoveryPhraseConfirmed).toBe(true);
  });

  it('returns 400 if recovery signer is not registered', async () => {
    await createUser('bob@example.com', '000000');
    await setEmailVerified('bob@example.com');
    await setWallet('bob@example.com', {
      walletContractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      stellarAddress: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      primaryPasskeyKeyId: 'test-key-id',
    });
    const token = await createSessionToken({ email: 'bob@example.com' });
    cookieJar[SESSION_COOKIE_NAME] = token;

    const res = await POST();
    expect(res.status).toBe(400);
  });
});
