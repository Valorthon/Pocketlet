import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { exhaustFeePayerBudget } from '@/lib/rate-limit.test-support';
import {
  createUser,
  setEmailVerified,
  getUserByEmail,
  setPasskeyChallenge,
} from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';

const CHALLENGE = 'test-passkey-challenge';

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

afterEach(() => {
  vi.unstubAllEnvs();
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
    await setPasskeyChallenge('alice@example.com', CHALLENGE);
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
    await setPasskeyChallenge('alice@example.com', CHALLENGE);

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
    await setPasskeyChallenge('alice@example.com', CHALLENGE);
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
    await setPasskeyChallenge('alice@example.com', CHALLENGE);
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

/**
 * Rate-limit wiring (issue #36).
 *
 * The limiter itself is tested in `src/lib/rate-limit.test.ts`. What matters
 * here is that this handler charges it, and charges it *before*
 * `takePasskeyChallenge` — that call clears a single-use nonce as it reads it,
 * so a throttled attempt that got past it would force the user to restart the
 * whole passkey ceremony for a request the server never performed.
 */
describe('POST /api/wallet/deploy rate limiting', () => {
  const EMAIL = 'alice@example.com';

  async function seedPendingDeploy() {
    await createUser(EMAIL, '000000');
    await setEmailVerified(EMAIL);
    await setPasskeyChallenge(EMAIL, CHALLENGE);
    return createSessionToken({ email: EMAIL });
  }

  function validDeploy(token: string) {
    return createDeployRequest(
      {
        response: { id: 'test-key-id' },
        keyIdBase64: 'test-key-id',
        contractId: 'CABC',
        signedTx: 'AAAA...',
      },
      token
    );
  }

  it('returns 429 once the fee-payer budget is spent', async () => {
    const token = await seedPendingDeploy();
    await exhaustFeePayerBudget('wallet.deploy', EMAIL);

    const res = await POST(validDeploy(token));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('does not burn the passkey challenge on a throttled attempt', async () => {
    const token = await seedPendingDeploy();
    await exhaustFeePayerBudget('wallet.deploy', EMAIL);

    expect((await POST(validDeploy(token))).status).toBe(429);

    // Same challenge, budget restored: the ceremony is still valid, which it
    // would not be if takePasskeyChallenge had run first.
    vi.unstubAllEnvs();
    const retry = await POST(validDeploy(token));
    expect(retry.status).toBe(200);
    expect((await getUserByEmail(EMAIL))?.walletContractId).toBe('CABC');
  });
});
