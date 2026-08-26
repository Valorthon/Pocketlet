import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
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
  cookieJar = {};
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
    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');
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

    const user = await getUserByEmail('alice@example.com');
    expect(user?.walletContractId).toBe('CABC');
    expect(user?.primaryPasskeyKeyId).toBe('test-key-id');
    expect(user?.recoveryPublicKey).toBeUndefined();
    expect(user?.credential?.id).toBe('test-key-id');
  });

  it('returns existing wallet if already deployed', async () => {
    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');

    const { setWallet } = await import('@/lib/auth/store');
    await setWallet('alice@example.com', {
      walletContractId: 'CEXISTING',
      stellarAddress: 'CEXISTING',
      primaryPasskeyKeyId: 'existing-key-id',
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
    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');
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

  it('rejects missing required fields', async () => {
    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');
    const token = await createSessionToken({ email: 'alice@example.com' });

    const req = createDeployRequest(
      {
        response: { id: 'test-key-id' },
        keyIdBase64: 'test-key-id',
        contractId: 'CABC',
      },
      token
    );

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('response, keyIdBase64, contractId, and signedTx are required');
  });
});
