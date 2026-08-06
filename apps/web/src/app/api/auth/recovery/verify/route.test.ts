import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
  setRecoveryInitiated,
} from '@/lib/auth/store';
import { keyStorage } from '@/lib/wallet/keys';

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
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-recovery-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
  cookieJar = {};
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
  vi.clearAllMocks();
});

function createEligibleUser(email: string) {
  createUser(email, '000000');
  setEmailVerified(email);
  setCredential(email, {
    id: 'cred-id',
    publicKey: 'base64-pubkey',
    counter: 0,
  });
  setWallet(email, {
    contractId: 'CABC',
    stellarAddress: 'CABC',
  });
  keyStorage.store(email, 'SABC');
}

describe('POST /api/auth/recovery/verify', () => {
  it('verifies a valid code and sets a recovery cookie', async () => {
    createEligibleUser('user@example.com');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    setRecoveryInitiated('user@example.com', '123456', expiresAt);

    const req = new NextRequest('http://localhost/api/auth/recovery/verify', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', code: '123456' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verified: boolean; readyAfter: string };
    expect(body.verified).toBe(true);
    expect(body.readyAfter).toBeDefined();
    expect(cookieJar.pocketlet_recovery).toBeDefined();
  });

  it('rejects an invalid code', async () => {
    createEligibleUser('user@example.com');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    setRecoveryInitiated('user@example.com', '123456', expiresAt);

    const req = new NextRequest('http://localhost/api/auth/recovery/verify', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', code: '000000' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects missing email or code', async () => {
    const req = new NextRequest('http://localhost/api/auth/recovery/verify', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
