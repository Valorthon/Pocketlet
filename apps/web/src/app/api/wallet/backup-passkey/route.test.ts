import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './route';
import { createUser, setEmailVerified, setWallet, getUserByEmail } from '@/lib/auth/store';
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
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-backup-passkey-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
  cookieJar = {};
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
  vi.clearAllMocks();
});

function createBackupRequest(body: unknown, token?: string) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/backup-passkey', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/wallet/backup-passkey', () => {
  it('returns 401 without a session cookie', async () => {
    const req = createBackupRequest({ keyIdBase64: 'backup-key-id' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('records a backup passkey', async () => {
    createUser('alice@example.com', '000000');
    setEmailVerified('alice@example.com');
    setWallet('alice@example.com', {
      walletContractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      stellarAddress: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      primaryPasskeyKeyId: 'test-key-id',
    });
    const token = await createSessionToken({ email: 'alice@example.com' });

    const req = createBackupRequest({ keyIdBase64: 'backup-key-id' }, token);
    const res = await POST(req);
    expect(res.status).toBe(200);

    const user = getUserByEmail('alice@example.com');
    expect(user?.hasBackupPasskey).toBe(true);
    expect(user?.backupPasskeyKeyId).toBe('backup-key-id');
  });

  it('rejects a missing keyIdBase64', async () => {
    createUser('bob@example.com', '000000');
    setEmailVerified('bob@example.com');
    setWallet('bob@example.com', {
      walletContractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      stellarAddress: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      primaryPasskeyKeyId: 'test-key-id',
    });
    const token = await createSessionToken({ email: 'bob@example.com' });

    const req = createBackupRequest({}, token);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
