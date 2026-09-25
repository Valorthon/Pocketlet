import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
  setRecoveryPublicKey,
  getUserByEmail,
} from '@/lib/auth/store';
import type { Mailer, MailMessage } from '@/lib/mail/mailer';

/**
 * The mailer the route delivers through, swapped per test.
 *
 * Stubbing the seam rather than `sendAuthCodeEmail` is deliberate: since
 * issue #18 the email is the only place the recovery code exists, so the
 * assertion worth making is that a *provider* is handed the code.
 */
let mailer: Mailer;
let sent: MailMessage[];

vi.mock('@/lib/mail/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mail/mailer')>();
  return { ...actual, getMailer: () => mailer };
});

beforeEach(() => {
  sent = [];
  mailer = {
    name: 'log',
    send: async (message) => {
      sent.push(message);
      return { ok: true, provider: 'log' };
    },
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function createRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/auth/recovery/initiate', {
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

describe('POST /api/auth/recovery/initiate', () => {
  it('returns 400 for an invalid email', async () => {
    const req = createRequest({ email: 'not-an-email' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unrecoverable account', async () => {
    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');
    const req = createRequest({ email: 'alice@example.com' });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('generates a recovery code for a recoverable account', async () => {
    await makeRecoverableUser('alice@example.com');
    const req = createRequest({ email: 'alice@example.com' });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { email: string; code?: string };
    expect(body.email).toBe('alice@example.com');

    // The code is read from the user row, not the response: since issue #18
    // the response must not carry it at all.
    const user = await getUserByEmail('alice@example.com');
    expect(user?.recoveryCode).toMatch(/^\d{6}$/);
    expect(user?.recoveryInitiatedAt).toBeDefined();
  });

  it('never returns the code in the response', async () => {
    await makeRecoverableUser('alice@example.com');
    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(200);

    const user = await getUserByEmail('alice@example.com');
    const raw = await res.text();
    expect(raw).not.toContain(user?.recoveryCode ?? 'no-code-was-stored');
    expect(JSON.parse(raw)).not.toHaveProperty('code');
  });

  it('emails the code', async () => {
    await makeRecoverableUser('alice@example.com');
    await POST(createRequest({ email: 'alice@example.com' }));

    const user = await getUserByEmail('alice@example.com');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('alice@example.com');
    expect(sent[0].text).toContain(user?.recoveryCode);
  });

  it('reports a delivery failure rather than claiming the code was sent', async () => {
    mailer = {
      name: 'broken',
      send: async () => ({ ok: false, provider: 'broken', error: 'nope' }),
    };
    await makeRecoverableUser('alice@example.com');

    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('could not send');
  });

  it('does not let a throwing mailer escape as a 500', async () => {
    mailer = {
      name: 'exploding',
      send: async () => {
        throw new Error('provider down');
      },
    };
    await makeRecoverableUser('alice@example.com');

    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(502);
  });

  it('rate-limits rapid initiations', async () => {
    await makeRecoverableUser('alice@example.com');
    await POST(createRequest({ email: 'alice@example.com' }));
    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(429);
  });

  it('enforces the hourly initiation cap', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await makeRecoverableUser('alice@example.com');

    // 5 initiations within an hour should succeed.
    for (let i = 0; i < 5; i += 1) {
      if (i > 0) {
        vi.advanceTimersByTime(2 * 60 * 1000); // advance past the 1-minute retry window
      }
      const res = await POST(createRequest({ email: 'alice@example.com' }));
      expect(res.status).toBe(200);
    }

    // A 6th initiation within the same hour is blocked.
    vi.advanceTimersByTime(2 * 60 * 1000);
    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(429);

    vi.useRealTimers();
  });
});

/**
 * Rate limiting (issue #121).
 *
 * This is one of the app's two genuinely unauthenticated endpoints, so there
 * is no session to key on: the buckets are the submitted address and the
 * client IP. The recovery-specific limits (a 60-second minimum retry and the
 * hourly initiation cap) are tested above and are unrelated to this one.
 */
describe('POST /api/auth/recovery/initiate rate limiting', () => {
  it('returns 429 once the per-email code budget is spent', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_EMAIL_PER_HOUR', '1');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await makeRecoverableUser('alice@example.com');

    expect((await POST(createRequest({ email: 'alice@example.com' }))).status).toBe(200);

    // Past the recovery-specific 60-second minimum retry, so the 429 below can
    // only be the general limiter.
    vi.advanceTimersByTime(2 * 60 * 1000);
    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();

    vi.useRealTimers();
  });

  it('returns 429 on the IP budget even as the address changes', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_IP_PER_HOUR', '1');
    const headers = { 'x-forwarded-for': '198.51.100.9' };
    await makeRecoverableUser('alice@example.com');
    await makeRecoverableUser('bob@example.com');

    expect(
      (await POST(createRequest({ email: 'alice@example.com' }, headers))).status
    ).toBe(200);

    const res = await POST(createRequest({ email: 'bob@example.com' }, headers));
    expect(res.status).toBe(429);
  });
});
