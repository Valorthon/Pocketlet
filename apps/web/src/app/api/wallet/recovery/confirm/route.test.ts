import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-recovery-confirm-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
  cookieJar = {};
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
  vi.clearAllMocks();
});

async function createConfirmedSession(email: string) {
  createUser(email, '000000');
  setEmailVerified(email);
  setWallet(email, {
    walletContractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
    stellarAddress: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
    primaryPasskeyKeyId: 'test-key-id',
  });
  setRecoveryPublicKey(
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

    const user = getUserByEmail('alice@example.com');
    expect(user?.recoveryPhraseConfirmed).toBe(true);
  });

  it('returns 400 if recovery signer is not registered', async () => {
    createUser('bob@example.com', '000000');
    setEmailVerified('bob@example.com');
    setWallet('bob@example.com', {
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
