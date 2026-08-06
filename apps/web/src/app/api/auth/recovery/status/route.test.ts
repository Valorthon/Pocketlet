import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
  setRecoveryInitiated,
  verifyRecoveryCode,
} from '@/lib/auth/store';
import { keyStorage } from '@/lib/wallet/keys';
import { createRecoveryToken } from '@/lib/auth/recovery-token';

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
  process.env.RECOVERY_WAITING_PERIOD_MS = '60000';
  cookieJar = {};
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
  delete process.env.RECOVERY_WAITING_PERIOD_MS;
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

describe('GET /api/auth/recovery/status', () => {
  it('returns pending before the waiting period elapses', async () => {
    createEligibleUser('user@example.com');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    setRecoveryInitiated('user@example.com', '123456', expiresAt);
    verifyRecoveryCode('user@example.com', '123456');

    const token = await createRecoveryToken('user@example.com');
    cookieJar.pocketlet_recovery = token;

    const req = new NextRequest('http://localhost/api/auth/recovery/status');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('pending');
  });

  it('returns ready after the waiting period elapses', async () => {
    createEligibleUser('user@example.com');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    setRecoveryInitiated('user@example.com', '123456', expiresAt);
    verifyRecoveryCode('user@example.com', '123456');

    const token = await createRecoveryToken('user@example.com');
    cookieJar.pocketlet_recovery = token;

    vi.setSystemTime(Date.now() + 2 * 60 * 1000);

    const req = new NextRequest('http://localhost/api/auth/recovery/status');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ready');

    vi.useRealTimers();
  });

  it('returns 401 without a recovery cookie', async () => {
    const req = new NextRequest('http://localhost/api/auth/recovery/status');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
