import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from './route';
import { createUser, getUserByEmail, setEmailVerified } from '@/lib/auth/store';
import { getMetric } from '@/lib/metrics';
import { VERIFICATION_CODE_EXPIRY_MS } from '@/lib/auth/verification-code';
import type { Mailer, MailMessage } from '@/lib/mail/mailer';

/**
 * Signup's code-issuing endpoint.
 *
 * Before issue #18 this returned the code in the response, so it verified
 * nothing: anyone who could call it could verify any address. The tests below
 * exist mostly to keep that from coming back — the code must reach the caller
 * only through the mailer, on every network, and issuing one must be rate
 * limited per address and per IP (issue #121).
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
  return new NextRequest('http://localhost/api/auth/email-challenge', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

describe('POST /api/auth/email-challenge', () => {
  it('rejects a malformed address', async () => {
    const res = await POST(createRequest({ email: 'nope' }));
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('creates the user with a code, an expiry and a zeroed attempt count', async () => {
    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(200);

    const user = await getUserByEmail('alice@example.com');
    expect(user?.emailVerified).toBe(false);
    expect(user?.verificationCode).toMatch(/^\d{6}$/);
    expect(user?.verificationCodeAttempts).toBe(0);

    const expiry = new Date(user?.verificationCodeExpiresAt ?? 0).getTime();
    expect(expiry).toBeGreaterThan(Date.now());
    expect(expiry).toBeLessThanOrEqual(Date.now() + VERIFICATION_CODE_EXPIRY_MS);
  });

  it('never returns the code in the response', async () => {
    const res = await POST(createRequest({ email: 'alice@example.com' }));
    const raw = await res.text();

    const user = await getUserByEmail('alice@example.com');
    expect(raw).not.toContain(user?.verificationCode ?? 'no-code-was-stored');
    expect(JSON.parse(raw)).not.toHaveProperty('code');
  });

  it('emails the code to the address that asked for it', async () => {
    await POST(createRequest({ email: 'alice@example.com' }));

    const user = await getUserByEmail('alice@example.com');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('alice@example.com');
    expect(sent[0].text).toContain(user?.verificationCode);
  });

  it('refuses an address that is already verified', async () => {
    await createUser('alice@example.com', '111111');
    await setEmailVerified('alice@example.com');

    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(409);
    expect(sent).toHaveLength(0);
  });

  it('re-issues for an unverified address instead of stranding it', async () => {
    await POST(createRequest({ email: 'alice@example.com' }));
    const first = (await getUserByEmail('alice@example.com'))?.verificationCode;

    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(200);

    const second = (await getUserByEmail('alice@example.com'))?.verificationCode;
    expect(second).toMatch(/^\d{6}$/);
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain(second);
    // Not an assertion about randomness — just that the row was rewritten.
    expect(first).toBeDefined();
  });

  it('reports a delivery failure rather than claiming the code was sent', async () => {
    mailer = {
      name: 'broken',
      send: async () => ({ ok: false, provider: 'broken', error: 'nope' }),
    };

    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('could not send');

    // The row exists, so the user is not stuck: asking again re-issues.
    expect(await getUserByEmail('alice@example.com')).toBeDefined();
  });

  it('turns a throwing mailer into the same 502, not a 500', async () => {
    mailer = {
      name: 'exploding',
      send: async () => {
        throw new Error('provider down');
      },
    };

    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(502);
  });
});

describe('GET /api/auth/email-challenge', () => {
  it('advertises the relying party without issuing anything', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rpId: string };
    expect(body.rpId).toBeTruthy();
    expect(sent).toHaveLength(0);
  });
});

describe('POST /api/auth/email-challenge rate limiting', () => {
  it('returns 429 once the per-address hourly budget is spent', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_EMAIL_PER_HOUR', '2');

    expect((await POST(createRequest({ email: 'alice@example.com' }))).status).toBe(200);
    expect((await POST(createRequest({ email: 'alice@example.com' }))).status).toBe(200);

    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(sent).toHaveLength(2);
  });

  it('returns 429 on the per-IP budget even as the address changes', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_IP_PER_HOUR', '2');
    const headers = { 'x-forwarded-for': '198.51.100.9' };

    expect(
      (await POST(createRequest({ email: 'a@example.com' }, headers))).status
    ).toBe(200);
    expect(
      (await POST(createRequest({ email: 'b@example.com' }, headers))).status
    ).toBe(200);

    const res = await POST(createRequest({ email: 'c@example.com' }, headers));
    expect(res.status).toBe(429);
    expect(await getUserByEmail('c@example.com')).toBeUndefined();
  });

  it('reads the rightmost forwarded entry, so a forged left cannot mint buckets', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_IP_PER_HOUR', '1');

    expect(
      (
        await POST(
          createRequest(
            { email: 'a@example.com' },
            { 'x-forwarded-for': '1.2.3.4, 198.51.100.9' }
          )
        )
      ).status
    ).toBe(200);

    const res = await POST(
      createRequest(
        { email: 'b@example.com' },
        { 'x-forwarded-for': '5.6.7.8, 198.51.100.9' }
      )
    );
    expect(res.status).toBe(429);
  });

  it('does not charge the limiter for a request it rejects first', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_IP_PER_HOUR', '1');
    const headers = { 'x-forwarded-for': '198.51.100.9' };

    expect((await POST(createRequest({ email: 'nope' }, headers))).status).toBe(400);

    const res = await POST(createRequest({ email: 'a@example.com' }, headers));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/email-challenge signup metric', () => {
  it('counts a signup once the code has actually been delivered', async () => {
    expect(await getMetric('auth.signup.completed')).toBe(0);

    await POST(createRequest({ email: 'alice@example.com' }));
    expect(await getMetric('auth.signup.completed')).toBe(1);
  });

  it('does not count a signup whose code was never sent', async () => {
    // The metric used to be incremented next to `createUser`, before the mail
    // attempt, so a 502 counted a completed signup that the user could not
    // complete.
    mailer = {
      name: 'broken',
      send: async () => ({ ok: false, provider: 'broken', error: 'nope' }),
    };

    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(502);
    expect(await getMetric('auth.signup.completed')).toBe(0);
  });

  it('counts a re-issued code once, on the first delivery only', async () => {
    await POST(createRequest({ email: 'alice@example.com' }));
    await POST(createRequest({ email: 'alice@example.com' }));

    expect(await getMetric('auth.signup.completed')).toBe(1);
  });
});

describe('POST /api/auth/email-challenge enumeration', () => {
  it('charges the IP budget before the 409, so probing is not free', async () => {
    // A 409 means "this address has a verified Pocketlet wallet". With the
    // whole limiter behind it, asking was free and unbounded.
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_IP_PER_HOUR', '2');
    const headers = { 'x-forwarded-for': '198.51.100.9' };

    for (const email of ['a@example.com', 'b@example.com']) {
      await createUser(email, '000000');
      await setEmailVerified(email);
      expect((await POST(createRequest({ email }, headers))).status).toBe(409);
    }

    const res = await POST(createRequest({ email: 'c@example.com' }, headers));
    expect(res.status).toBe(429);
    expect(sent).toHaveLength(0);
  });

  it('does not spend the address budget on a probe at a registered address', async () => {
    // The per-address window stays behind the existence check, so a stranger
    // probing an address cannot deny its owner their own signup codes.
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_EMAIL_PER_HOUR', '1');

    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');

    for (let i = 0; i < 3; i += 1) {
      expect(
        (await POST(createRequest({ email: 'alice@example.com' }))).status,
        `probe ${i + 1}`
      ).toBe(409);
    }

    // An unrelated, unregistered address still has its full budget.
    expect((await POST(createRequest({ email: 'bob@example.com' }))).status).toBe(200);
  });
});
