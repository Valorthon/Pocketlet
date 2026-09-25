import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
  setRecoveryPublicKey,
  setRecoveryInitiated,
  getUserByEmail,
  RECOVERY_MAX_ATTEMPTS,
} from '@/lib/auth/store';
import { RECOVERY_COOKIE_NAME } from '@/lib/auth/recovery-token';

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
  cookieJar = {};
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function createRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/auth/recovery/verify', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

async function makeRecoverableUser(email: string) {
  await createUser(email, '000000');
  await setEmailVerified(email);
  await setCredential(email, {
    id: 'primary-key-id',
    publicKey: 'cHVibGljLWtleQ',
    counter: 0,
  });
  await setWallet(email, {
    walletContractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
    stellarAddress: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
    primaryPasskeyKeyId: 'primary-key-id',
  });
  await setRecoveryPublicKey(email, 'GDDOY5WE2IDQMJS4HIASB5G7GFXMGQ4O4YYT46QETSWAC65JIFBB25KP');
}

describe('POST /api/auth/recovery/verify', () => {
  it('returns 400 when email or code is missing', async () => {
    const req = createRequest({ email: 'alice@example.com' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown user', async () => {
    const req = createRequest({ email: 'unknown@example.com', code: '123456' });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 401 for an invalid code', async () => {
    await makeRecoverableUser('alice@example.com');
    await setRecoveryInitiated('alice@example.com', '123456', new Date(Date.now() + 60000).toISOString());
    const req = createRequest({ email: 'alice@example.com', code: '000000' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('sets a recovery cookie and returns the waiting period on success', async () => {
    await makeRecoverableUser('alice@example.com');
    await setRecoveryInitiated('alice@example.com', '123456', new Date(Date.now() + 60000).toISOString());
    const req = createRequest({ email: 'alice@example.com', code: '123456' });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      email: string;
      verified: boolean;
      readyAfter: string;
      waitingPeriodMs: number;
    };
    expect(body.email).toBe('alice@example.com');
    expect(body.verified).toBe(true);
    expect(body.waitingPeriodMs).toBeGreaterThan(0);
    expect(cookieJar[RECOVERY_COOKIE_NAME]).toBeDefined();
  });
});

/**
 * The recovery code is the highest-stakes one in the app — verifying it opens
 * the flow that re-keys the wallet — and it was the only one still compared
 * with `!==`, against an attempt cap that a parallel burst walked straight
 * past. It now goes through the same `constantTimeEquals` as every other code,
 * under the same row lock, behind a rate limit of its own.
 */
describe('POST /api/auth/recovery/verify code handling', () => {
  async function initiate(code = '123456'): Promise<void> {
    await makeRecoverableUser('alice@example.com');
    await setRecoveryInitiated(
      'alice@example.com',
      code,
      new Date(Date.now() + 60_000).toISOString()
    );
  }

  it('compares the whole code, not a prefix', async () => {
    // The behavioural half of "constant-time": a code sharing five of six
    // digits is exactly as wrong as one sharing none, and a longer string that
    // starts with the code is wrong too.
    await initiate();

    for (const wrong of ['12345', '1234567', '123450', ' 123456']) {
      const res = await POST(
        createRequest({ email: 'alice@example.com', code: wrong })
      );
      expect(res.status, `code ${JSON.stringify(wrong)}`).toBe(401);
      expect(cookieJar[RECOVERY_COOKIE_NAME]).toBeUndefined();
    }
  });

  it('locks the account after the attempt cap', async () => {
    await initiate();

    for (let i = 0; i < RECOVERY_MAX_ATTEMPTS; i += 1) {
      const res = await POST(
        createRequest({ email: 'alice@example.com', code: '000000' })
      );
      expect(res.status, `guess ${i + 1}`).toBe(401);
    }

    expect(
      (await getUserByEmail('alice@example.com'))?.recoveryLockedUntil
    ).toBeDefined();

    // The correct code is refused while the lockout stands.
    const res = await POST(
      createRequest({ email: 'alice@example.com', code: '123456' })
    );
    expect(res.status).toBe(401);
    expect(cookieJar[RECOVERY_COOKIE_NAME]).toBeUndefined();
  });

  it('returns 400 rather than 500 for a non-string code', async () => {
    await initiate();

    for (const code of [123456, null, ['123456']]) {
      const res = await POST(createRequest({ email: 'alice@example.com', code }));
      expect(res.status, JSON.stringify(code)).toBe(400);
    }
  });
});

describe('POST /api/auth/recovery/verify rate limiting', () => {
  it('returns 429 once the per-address guess budget is spent', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_VERIFY_PER_EMAIL_PER_HOUR', '2');
    await makeRecoverableUser('alice@example.com');
    await setRecoveryInitiated(
      'alice@example.com',
      '123456',
      new Date(Date.now() + 60_000).toISOString()
    );

    for (let i = 0; i < 2; i += 1) {
      const res = await POST(
        createRequest({ email: 'alice@example.com', code: '000000' })
      );
      expect(res.status, `guess ${i + 1}`).toBe(401);
    }

    const res = await POST(
      createRequest({ email: 'alice@example.com', code: '123456' })
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(cookieJar[RECOVERY_COOKIE_NAME]).toBeUndefined();
  });

  it('bounds the 404, so an unknown address is not a free oracle', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_VERIFY_PER_IP_PER_HOUR', '2');
    const headers = { 'x-forwarded-for': '198.51.100.9' };

    for (const email of ['a@example.com', 'b@example.com']) {
      const res = await POST(createRequest({ email, code: '123456' }, headers));
      expect(res.status).toBe(404);
    }

    const res = await POST(
      createRequest({ email: 'c@example.com', code: '123456' }, headers)
    );
    expect(res.status).toBe(429);
  });
});
