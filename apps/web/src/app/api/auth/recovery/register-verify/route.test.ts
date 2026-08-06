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
  setPendingChallenge,
  verifyRecoveryCode,
  getUserByEmail,
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

vi.mock('@simplewebauthn/server', async () => {
  const actual = await vi.importActual<typeof import('@simplewebauthn/server')>(
    '@simplewebauthn/server'
  );
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn().mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'new-cred-id',
          publicKey: Buffer.from('new-public-key'),
          counter: 0,
          transports: [],
        },
      },
    }),
  };
});

vi.mock('@/lib/wallet/recover', () => ({
  rotateWalletOwner: vi.fn().mockResolvedValue({ hash: 'txhash123' }),
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

describe('POST /api/auth/recovery/register-verify', () => {
  it('registers a new passkey after the waiting period and clears recovery state', async () => {
    createEligibleUser('user@example.com');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    setRecoveryInitiated('user@example.com', '123456', expiresAt);
    verifyRecoveryCode('user@example.com', '123456');
    setPendingChallenge('user@example.com', 'challenge-value');

    const token = await createRecoveryToken('user@example.com');
    cookieJar.pocketlet_recovery = token;

    vi.setSystemTime(Date.now() + 2 * 60 * 1000);

    const req = new NextRequest(
      'http://localhost/api/auth/recovery/register-verify',
      {
        method: 'POST',
        body: JSON.stringify({ response: { id: 'new-cred-id' } }),
      }
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verified: boolean; contractId: string };
    expect(body.verified).toBe(true);
    expect(body.contractId).toBe('CABC');

    const user = getUserByEmail('user@example.com');
    expect(user?.credential?.id).toBe('new-cred-id');
    expect(user?.recoveryVerifiedAt).toBeUndefined();
    expect(res.cookies.get('pocketlet_session')?.value).toBeDefined();

    vi.useRealTimers();
  });

  it('rejects before the waiting period elapses', async () => {
    createEligibleUser('user@example.com');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    setRecoveryInitiated('user@example.com', '123456', expiresAt);
    verifyRecoveryCode('user@example.com', '123456');

    const token = await createRecoveryToken('user@example.com');
    cookieJar.pocketlet_recovery = token;

    const req = new NextRequest(
      'http://localhost/api/auth/recovery/register-verify',
      {
        method: 'POST',
        body: JSON.stringify({ response: { id: 'new-cred-id' } }),
      }
    );
    const res = await POST(req);
    expect(res.status).toBe(403);

    vi.useRealTimers();
  });

  it('returns 401 without a recovery cookie', async () => {
    const req = new NextRequest(
      'http://localhost/api/auth/recovery/register-verify',
      {
        method: 'POST',
        body: JSON.stringify({ response: { id: 'new-cred-id' } }),
      }
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
