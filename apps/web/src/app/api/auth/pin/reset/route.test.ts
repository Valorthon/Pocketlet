import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import {
  createUser,
  getUserByEmail,
  setEmailVerified,
  setPin,
} from '@/lib/auth/store';
import { verifyPin } from '@/lib/auth/pin';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import {
  VERIFICATION_CODE_EXPIRY_MS,
  VERIFICATION_CODE_MAX_ATTEMPTS,
} from '@/lib/auth/verification-code';
import type { Mailer, MailMessage } from '@/lib/mail/mailer';

/**
 * PIN reset: request a code, then spend it.
 *
 * The code used to come back in the response (issue #18), never expired and
 * was compared with `===` against unlimited guesses (issue #121). All four
 * properties are asserted here.
 */

let cookieJar: Record<string, string> = {};

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() => ({
    get: (name: string) =>
      cookieJar[name] ? { value: cookieJar[name], name } : undefined,
    set: (name: string, value: string) => {
      cookieJar[name] = value;
    },
  })),
}));

let mailer: Mailer;
let sent: MailMessage[];

vi.mock('@/lib/mail/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mail/mailer')>();
  return { ...actual, getMailer: () => mailer };
});

beforeEach(() => {
  cookieJar = {};
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

const EMAIL = 'alice@example.com';

async function signIn(email = EMAIL): Promise<void> {
  await createUser(email, '000000');
  await setEmailVerified(email);
  await setPin(email, '111111');
  cookieJar[SESSION_COOKIE_NAME] = await createSessionToken({ email });
}

function createRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/auth/pin/reset', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

/** Ask for a code and read it out of the user row, where it now lives. */
async function requestCode(email = EMAIL): Promise<string> {
  const res = await POST(createRequest({ action: 'request' }));
  expect(res.status).toBe(200);
  const user = await getUserByEmail(email);
  if (!user?.pinResetCode) {
    throw new Error('no reset code was stored');
  }
  return user.pinResetCode;
}

describe('POST /api/auth/pin/reset', () => {
  it('returns 401 without a session', async () => {
    const res = await POST(createRequest({ action: 'request' }));
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('rejects an unknown action', async () => {
    await signIn();
    const res = await POST(createRequest({ action: 'sideways' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/pin/reset (request)', () => {
  it('stores a code with an expiry and a zeroed attempt count', async () => {
    await signIn();
    await requestCode();

    const user = await getUserByEmail(EMAIL);
    expect(user?.pinResetCode).toMatch(/^\d{6}$/);
    expect(user?.pinResetCodeAttempts).toBe(0);

    const expiry = new Date(user?.pinResetCodeExpiresAt ?? 0).getTime();
    expect(expiry).toBeGreaterThan(Date.now());
    expect(expiry).toBeLessThanOrEqual(Date.now() + VERIFICATION_CODE_EXPIRY_MS);
  });

  it('never returns the code in the response', async () => {
    await signIn();
    const res = await POST(createRequest({ action: 'request' }));
    const raw = await res.text();

    const user = await getUserByEmail(EMAIL);
    expect(raw).not.toContain(user?.pinResetCode ?? 'no-code-was-stored');
    expect(JSON.parse(raw)).not.toHaveProperty('code');
  });

  it('emails the code', async () => {
    await signIn();
    const code = await requestCode();

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(EMAIL);
    expect(sent[0].text).toContain(code);
  });

  it('reports a delivery failure rather than claiming the code was sent', async () => {
    await signIn();
    mailer = {
      name: 'broken',
      send: async () => ({ ok: false, provider: 'broken', error: 'nope' }),
    };

    const res = await POST(createRequest({ action: 'request' }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('could not send');
  });

  it('turns a throwing mailer into the same 502, not a 500', async () => {
    await signIn();
    mailer = {
      name: 'exploding',
      send: async () => {
        throw new Error('provider down');
      },
    };

    expect((await POST(createRequest({ action: 'request' }))).status).toBe(502);
  });
});

describe('POST /api/auth/pin/reset (reset)', () => {
  it('sets the new PIN and clears the code', async () => {
    await signIn();
    const code = await requestCode();

    const res = await POST(createRequest({ action: 'reset', code, pin: '246810' }));
    expect(res.status).toBe(200);

    const user = await getUserByEmail(EMAIL);
    expect(user?.pinResetCode).toBeUndefined();
    expect(user?.pinResetCodeExpiresAt).toBeUndefined();
    expect(user?.pinResetCodeAttempts).toBeUndefined();
    expect(verifyPin('246810', user?.pinHash ?? '')).toBe(true);
  });

  it('rejects a malformed PIN before touching the code', async () => {
    await signIn();
    const code = await requestCode();

    const res = await POST(createRequest({ action: 'reset', code, pin: '12' }));
    expect(res.status).toBe(400);
    expect((await getUserByEmail(EMAIL))?.pinResetCodeAttempts).toBe(0);
  });

  it('rejects a wrong code and counts the attempt', async () => {
    await signIn();
    await requestCode();

    const res = await POST(
      createRequest({ action: 'reset', code: '000000', pin: '246810' })
    );
    expect(res.status).toBe(401);
    expect((await getUserByEmail(EMAIL))?.pinResetCodeAttempts).toBe(1);
    expect(verifyPin('246810', (await getUserByEmail(EMAIL))?.pinHash ?? '')).toBe(
      false
    );
  });

  it('rejects an expired code', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await signIn();
    const code = await requestCode();

    vi.advanceTimersByTime(VERIFICATION_CODE_EXPIRY_MS + 1000);

    const res = await POST(createRequest({ action: 'reset', code, pin: '246810' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('expired');
    expect(verifyPin('246810', (await getUserByEmail(EMAIL))?.pinHash ?? '')).toBe(
      false
    );

    vi.useRealTimers();
  });

  it('destroys the code after the attempt cap, so the right code stops working', async () => {
    await signIn();
    const code = await requestCode();

    for (let i = 1; i < VERIFICATION_CODE_MAX_ATTEMPTS; i += 1) {
      const res = await POST(
        createRequest({ action: 'reset', code: '000000', pin: '246810' })
      );
      expect(res.status, `attempt ${i}`).toBe(401);
    }

    const capped = await POST(
      createRequest({ action: 'reset', code: '000000', pin: '246810' })
    );
    expect(capped.status).toBe(429);

    // The correct code, straight after the lockout, still fails.
    const afterLockout = await POST(
      createRequest({ action: 'reset', code, pin: '246810' })
    );
    expect(afterLockout.status).toBe(401);
    expect(verifyPin('246810', (await getUserByEmail(EMAIL))?.pinHash ?? '')).toBe(
      false
    );
  });

  it('accepts the code again after a fresh one is requested', async () => {
    await signIn();
    await requestCode();

    for (let i = 0; i < VERIFICATION_CODE_MAX_ATTEMPTS; i += 1) {
      await POST(createRequest({ action: 'reset', code: '000000', pin: '246810' }));
    }

    const fresh = await requestCode();
    const res = await POST(
      createRequest({ action: 'reset', code: fresh, pin: '246810' })
    );
    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/pin/reset rate limiting', () => {
  it('returns 429 once the per-address hourly budget is spent', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_EMAIL_PER_HOUR', '2');
    await signIn();

    expect((await POST(createRequest({ action: 'request' }))).status).toBe(200);
    expect((await POST(createRequest({ action: 'request' }))).status).toBe(200);

    const res = await POST(createRequest({ action: 'request' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(sent).toHaveLength(2);
  });

  it('does not charge the issuing limiter for spending a code', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_EMAIL_PER_HOUR', '1');
    await signIn();
    const code = await requestCode();

    const res = await POST(createRequest({ action: 'reset', code, pin: '246810' }));
    expect(res.status).toBe(200);
  });

  /**
   * `reset` is the guessing surface and had no limit of its own. It gets the
   * verifier budget, which is separate from the issuing one above: asking for
   * a code must not cost you the guesses at it, or the other way round.
   */
  it('returns 429 once the guess budget is spent', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_VERIFY_PER_EMAIL_PER_HOUR', '2');
    await signIn();
    const code = await requestCode();

    for (let i = 0; i < 2; i += 1) {
      const res = await POST(
        createRequest({ action: 'reset', code: '000000', pin: '246810' })
      );
      expect(res.status, `guess ${i + 1}`).toBe(401);
    }

    const res = await POST(createRequest({ action: 'reset', code, pin: '246810' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(verifyPin('246810', (await getUserByEmail(EMAIL))?.pinHash ?? '')).toBe(
      false
    );
  });

  it('does not charge the guess budget for requesting a code', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_VERIFY_PER_EMAIL_PER_HOUR', '1');
    await signIn();
    const code = await requestCode();

    const res = await POST(createRequest({ action: 'reset', code, pin: '246810' }));
    expect(res.status).toBe(200);
  });

  it('does not charge the guess budget for a malformed body', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_VERIFY_PER_EMAIL_PER_HOUR', '1');
    await signIn();
    const code = await requestCode();

    expect(
      (await POST(createRequest({ action: 'reset', code, pin: 'nope' }))).status
    ).toBe(400);

    const res = await POST(createRequest({ action: 'reset', code, pin: '246810' }));
    expect(res.status).toBe(200);
  });
});

/**
 * A cast is not a check (issue found in review of #18).
 *
 * `body` is cast `as { code?: string }`, so `{"code": 654321}` satisfied the
 * compiler, was truthy, passed the `!code` guard and reached
 * `createHash().update(code, 'utf8')` — which throws `ERR_INVALID_ARG_TYPE`.
 * The handler died with an unhandled rejection and a 500 where the answer had
 * been a 401.
 */
describe('POST /api/auth/pin/reset (reset) with a non-string body', () => {
  it.each([
    ['a number', 654321],
    ['null', null],
    ['an object', { code: '654321' }],
    ['an array', ['654321']],
    ['a boolean', true],
  ])('answers 400 for %s code, not 500', async (_label, code) => {
    await signIn();
    await requestCode();

    const res = await POST(createRequest({ action: 'reset', code, pin: '222222' }));
    expect(res.status).toBe(400);
    expect(verifyPin('222222', (await getUserByEmail(EMAIL))?.pinHash ?? '')).toBe(
      false
    );
  });

  it('answers 400 for a non-string PIN', async () => {
    await signIn();
    const code = await requestCode();

    const res = await POST(createRequest({ action: 'reset', code, pin: 222222 }));
    expect(res.status).toBe(400);
  });

  it('does not spend an attempt on a request it never evaluated', async () => {
    await signIn();
    await requestCode();

    await POST(createRequest({ action: 'reset', code: 654321, pin: '222222' }));

    expect((await getUserByEmail(EMAIL))?.pinResetCodeAttempts).toBe(0);
  });
});
