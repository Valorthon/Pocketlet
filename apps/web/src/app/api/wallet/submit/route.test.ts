import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './route';
import { createUser, setEmailVerified, setWallet } from '@/lib/auth/store';
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

vi.mock('@/lib/wallet/submit', () => ({
  submitSignedTransaction: vi.fn().mockResolvedValue({ hash: 'submitted-tx-hash' }),
}));

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-submit-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
  cookieJar = {};
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
  vi.clearAllMocks();
});

function createSubmitRequest(body: unknown, token?: string) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/submit', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/wallet/submit', () => {
  it('returns 401 without a session cookie', async () => {
    const req = createSubmitRequest({ signedXdr: 'AAAA...' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 404 if wallet is not deployed', async () => {
    createUser('alice@example.com', '000000');
    setEmailVerified('alice@example.com');
    const token = await createSessionToken({ email: 'alice@example.com' });

    const req = createSubmitRequest({ signedXdr: 'AAAA...' }, token);
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 400 for a malformed XDR', async () => {
    createUser('alice@example.com', '000000');
    setEmailVerified('alice@example.com');
    setWallet('alice@example.com', {
      walletContractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      stellarAddress: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      primaryPasskeyKeyId: 'test-key-id',
    });
    const token = await createSessionToken({ email: 'alice@example.com' });

    const req = createSubmitRequest({ signedXdr: 'not-valid-xdr' }, token);
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
