import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
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

vi.mock('@simplewebauthn/server', () => ({
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'test-key-id',
        publicKey: Buffer.from('test-public-key'),
        counter: 0,
        transports: [],
      },
    },
  }),
}));

vi.mock('@/lib/wallet/submit', () => ({
  submitSignedTransaction: vi.fn().mockResolvedValue({ hash: 'deploy-tx-hash' }),
}));

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-deploy-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
  cookieJar = {};
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
  vi.clearAllMocks();
});

function createDeployRequest(body: unknown, token?: string) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/deploy', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/wallet/deploy', () => {
  it('returns 401 without a session cookie', async () => {
    const req = createDeployRequest({
      response: {},
      keyIdBase64: 'test-key-id',
      contractId: 'CABC',
      signedTx: 'AAAA...',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('deploys a wallet and stores the contract id', async () => {
    createUser('alice@example.com', '000000');
    setEmailVerified('alice@example.com');
    const token = await createSessionToken({ email: 'alice@example.com' });

    const req = createDeployRequest(
      {
        response: { id: 'test-key-id' },
        keyIdBase64: 'test-key-id',
        contractId: 'CABC',
        signedTx: 'AAAA...',
      },
      token
    );

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { contractId: string; hash: string };
    expect(body.contractId).toBe('CABC');
    expect(body.hash).toBe('deploy-tx-hash');

    const user = getUserByEmail('alice@example.com');
    expect(user?.contractId).toBe('CABC');
    expect(user?.credential?.id).toBe('test-key-id');
  });

  it('returns existing wallet if already deployed', async () => {
    createUser('alice@example.com', '000000');
    setEmailVerified('alice@example.com');

    const { setWallet } = await import('@/lib/auth/store');
    setWallet('alice@example.com', {
      contractId: 'CEXISTING',
      stellarAddress: 'CEXISTING',
    });

    const token = await createSessionToken({ email: 'alice@example.com' });
    const req = createDeployRequest(
      {
        response: {},
        keyIdBase64: 'test-key-id',
        contractId: 'CABC',
        signedTx: 'AAAA...',
      },
      token
    );

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { contractId: string };
    expect(body.contractId).toBe('CEXISTING');
  });

  it('rejects mismatched credential id', async () => {
    createUser('alice@example.com', '000000');
    setEmailVerified('alice@example.com');
    const token = await createSessionToken({ email: 'alice@example.com' });

    const req = createDeployRequest(
      {
        response: { id: 'test-key-id' },
        keyIdBase64: 'different-key-id',
        contractId: 'CABC',
        signedTx: 'AAAA...',
      },
      token
    );

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Credential id does not match');
  });
});
