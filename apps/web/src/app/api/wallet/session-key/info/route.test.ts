import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
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
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-session-key-info-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
  cookieJar = {};
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
  vi.clearAllMocks();
});

describe('GET /api/wallet/session-key/info', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns wallet info for an authenticated user', async () => {
    createUser('alice@example.com', '000000');
    setEmailVerified('alice@example.com');
    setCredential('alice@example.com', {
      id: 'cred-id',
      publicKey: 'base64-pubkey',
      counter: 0,
    });
    setWallet('alice@example.com', {
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
    createUser('bob@example.com', '000000');
    setEmailVerified('bob@example.com');

    const token = await createSessionToken({ email: 'bob@example.com' });
    cookieJar[SESSION_COOKIE_NAME] = token;

    const res = await GET();
    expect(res.status).toBe(404);
  });
});
