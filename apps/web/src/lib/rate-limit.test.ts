import { describe, it, expect, afterEach, vi } from 'vitest';
import { db, schema } from '@/lib/db';
import {
  authCodePolicies,
  consumeRateLimit,
  enforceAuthCodeRateLimit,
  enforceFeePayerRateLimit,
  enforceResolveRateLimit,
  feePayerPolicies,
  rateLimitBucket,
  resolvePolicies,
} from './rate-limit';

const MINUTE = 60_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function req(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('consumeRateLimit', () => {
  const policy = { limit: 3, windowMs: MINUTE };

  it('allows requests up to the limit and rejects the next one', async () => {
    const now = 1_700_000_000_000;

    for (let i = 0; i < 3; i += 1) {
      const decision = await consumeRateLimit('b', policy, now);
      expect(decision.allowed, `request ${i + 1}`).toBe(true);
    }

    const over = await consumeRateLimit('b', policy, now);
    expect(over.allowed).toBe(false);
  });

  it('reports how long is left in the window', async () => {
    const start = 1_700_000_000_000;
    await consumeRateLimit('b', { limit: 1, windowMs: MINUTE }, start);
    const over = await consumeRateLimit(
      'b',
      { limit: 1, windowMs: MINUTE },
      start + 15_000
    );
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBe(45);
  });

  it('never reports a Retry-After below one second', async () => {
    const start = 1_700_000_000_000;
    await consumeRateLimit('b', { limit: 1, windowMs: MINUTE }, start);
    const over = await consumeRateLimit(
      'b',
      { limit: 1, windowMs: MINUTE },
      start + MINUTE - 1
    );
    expect(over.retryAfterSeconds).toBe(1);
  });

  it('resets once the window has elapsed', async () => {
    const start = 1_700_000_000_000;
    await consumeRateLimit('b', { limit: 1, windowMs: MINUTE }, start);
    expect(
      (await consumeRateLimit('b', { limit: 1, windowMs: MINUTE }, start)).allowed
    ).toBe(false);

    const after = await consumeRateLimit(
      'b',
      { limit: 1, windowMs: MINUTE },
      start + MINUTE + 1
    );
    expect(after.allowed).toBe(true);
  });

  it('stores the window start it was given rather than the database clock', async () => {
    // The whole limiter is testable only because this number comes from JS.
    const now = 1_700_000_000_000;
    await consumeRateLimit('clock-check', policy, now);
    const [row] = await db.select().from(schema.rateLimits);
    expect(row.bucket).toBe('clock-check');
    expect(Number(row.windowStart)).toBe(now);
  });

  it('keeps separate buckets independent', async () => {
    const now = 1_700_000_000_000;
    await consumeRateLimit('one', { limit: 1, windowMs: MINUTE }, now);
    const other = await consumeRateLimit('two', { limit: 1, windowMs: MINUTE }, now);
    expect(other.allowed).toBe(true);
  });
});

describe('rateLimitBucket', () => {
  it('separates per-user, per-IP, per-route and per-window counters', () => {
    const keys = new Set([
      rateLimitBucket('wallet.submit', 'user', 'a@b.com', MINUTE),
      rateLimitBucket('wallet.submit', 'ip', 'a@b.com', MINUTE),
      rateLimitBucket('wallet.transfer', 'user', 'a@b.com', MINUTE),
      rateLimitBucket('wallet.submit', 'user', 'a@b.com', 86_400_000),
      rateLimitBucket('wallet.submit', 'user', 'c@d.com', MINUTE),
    ]);
    expect(keys.size).toBe(5);
  });
});

describe('policy configuration', () => {
  it('falls back to the defaults when the environment is unset', () => {
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '');
    expect(feePayerPolicies()[0].policy).toEqual({ limit: 10, windowMs: MINUTE });
  });

  it('reads the limits from the environment', () => {
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '3');
    vi.stubEnv('RATE_LIMIT_RESOLVE_PER_IP_PER_MINUTE', '7');
    expect(feePayerPolicies()[0].policy.limit).toBe(3);
    expect(resolvePolicies()[1].policy.limit).toBe(7);
  });

  it.each(['0', '-5', 'many'])(
    'ignores %o rather than locking every user out',
    (raw) => {
      vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', raw);
      expect(feePayerPolicies()[0].policy.limit).toBe(10);
    }
  );

  /**
   * The parser must not turn a fat-fingered value into a near-total lockout.
   * `Number.parseInt('1e4', 10)` is 1, and a per-user limit of 1 locks every
   * user out of their own wallet after a single transaction — the exact
   * failure the fallback exists to prevent.
   */
  it.each([
    ['1e4', 10000],
    [' 50 ', 50],
    ['100x', 10],
    ['0', 10],
    ['-5', 10],
    ['', 10],
    ['1.5', 10],
    ['Infinity', 10],
    [undefined, 10],
  ])('reads %o as a limit of %i', (raw, expected) => {
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', raw);
    expect(feePayerPolicies()[0].policy.limit).toBe(expected);
  });

  it('gives the per-IP windows real headroom over the per-user ones', () => {
    // A household, office or CGNAT egress carries several accounts. At only 2x
    // the per-user value, three ordinary users behind one address exhausted the
    // shared budget before any of them reached their own entitlement.
    const [userMinute, userDay, ipMinute, ipDay] = feePayerPolicies();
    expect(ipMinute.policy.limit).toBeGreaterThanOrEqual(
      userMinute.policy.limit * 4
    );
    expect(ipDay.policy.limit).toBeGreaterThanOrEqual(userDay.policy.limit * 4);
  });

  it('gives resolve a looser per-user limit than the fee-payer routes', () => {
    expect(resolvePolicies()[0].policy.limit).toBeGreaterThan(
      feePayerPolicies()[0].policy.limit
    );
  });
});

describe('enforceFeePayerRateLimit', () => {
  it('returns a 429 with Retry-After once the per-user limit is exceeded', async () => {
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '1');

    expect(
      await enforceFeePayerRateLimit(req(), 'wallet.submit', 'a@b.com')
    ).toBeNull();

    const limited = await enforceFeePayerRateLimit(
      req(),
      'wallet.submit',
      'a@b.com'
    );
    expect(limited?.status).toBe(429);
    expect(Number(limited?.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = (await limited?.json()) as { error: string };
    expect(body.error).toContain('Too many requests');
  });

  it('says which limit was hit, so the client can say something true', async () => {
    // "Please wait a moment" alongside Retry-After: 86400 is a lie. The minute
    // window can never ask for more than 60 seconds, so anything longer is the
    // daily budget.
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '1');
    await enforceFeePayerRateLimit(req(), 'wallet.submit', 'short@b.com');
    const short = await enforceFeePayerRateLimit(
      req(),
      'wallet.submit',
      'short@b.com'
    );
    expect(Number(short?.headers.get('Retry-After'))).toBeLessThanOrEqual(60);
    expect(((await short?.json()) as { error: string }).error).toContain(
      'wait a moment'
    );

    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '50');
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_DAY', '1');
    await enforceFeePayerRateLimit(req(), 'wallet.submit', 'daily@b.com');
    const daily = await enforceFeePayerRateLimit(
      req(),
      'wallet.submit',
      'daily@b.com'
    );
    expect(Number(daily?.headers.get('Retry-After'))).toBeGreaterThan(60);
    expect(((await daily?.json()) as { error: string }).error).toContain(
      'daily limit'
    );
  });

  it('budgets each route separately', async () => {
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '1');

    await enforceFeePayerRateLimit(req(), 'wallet.submit', 'a@b.com');
    expect(
      await enforceFeePayerRateLimit(req(), 'wallet.transfer', 'a@b.com')
    ).toBeNull();
  });

  it('treats the same address in different letter case as one user', async () => {
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '1');

    await enforceFeePayerRateLimit(req(), 'wallet.submit', 'a@b.com');
    const limited = await enforceFeePayerRateLimit(
      req(),
      'wallet.submit',
      'A@B.com'
    );
    expect(limited?.status).toBe(429);
  });

  it('does not charge the looser windows for an already-refused request', async () => {
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '1');

    await enforceFeePayerRateLimit(req(), 'wallet.submit', 'a@b.com');
    await enforceFeePayerRateLimit(req(), 'wallet.submit', 'a@b.com');

    const dayBucket = rateLimitBucket(
      'wallet.submit',
      'user',
      'a@b.com',
      86_400_000
    );
    const rows = await db.select().from(schema.rateLimits);
    const day = rows.find((row) => row.bucket === dayBucket);
    expect(day?.count).toBe(1);
  });
});

describe('enforceResolveRateLimit', () => {
  it('rejects only after the looser resolve limit is passed', async () => {
    vi.stubEnv('RATE_LIMIT_RESOLVE_PER_USER_PER_MINUTE', '2');

    expect(await enforceResolveRateLimit(req(), 'a@b.com')).toBeNull();
    expect(await enforceResolveRateLimit(req(), 'a@b.com')).toBeNull();
    expect((await enforceResolveRateLimit(req(), 'a@b.com'))?.status).toBe(429);
  });

  it('does not share a budget with the fee-payer routes', async () => {
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '1');
    vi.stubEnv('RATE_LIMIT_RESOLVE_PER_USER_PER_MINUTE', '1');

    await enforceFeePayerRateLimit(req(), 'wallet.submit', 'a@b.com');
    expect(await enforceResolveRateLimit(req(), 'a@b.com')).toBeNull();
  });
});

/**
 * The one-time-code endpoints (issue #121).
 *
 * These spend mail rather than Stellar fees, and two of the three are
 * unauthenticated, so the 'user' subject is the *submitted* address rather
 * than a session identity.
 */
describe('authCodePolicies', () => {
  it('defaults to an hourly per-address budget and two per-IP backstops', () => {
    expect(authCodePolicies()).toEqual([
      { kind: 'user', policy: { limit: 5, windowMs: HOUR } },
      { kind: 'ip', policy: { limit: 20, windowMs: HOUR } },
      { kind: 'ip', policy: { limit: 100, windowMs: DAY } },
    ]);
  });

  it('reads the limits from the environment', () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_EMAIL_PER_HOUR', '2');
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_IP_PER_HOUR', '3');
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_IP_PER_DAY', '4');
    expect(authCodePolicies().map((entry) => entry.policy.limit)).toEqual([2, 3, 4]);
  });

  it.each(['0', '-1', 'lots'])(
    'ignores %o rather than making signup impossible',
    (raw) => {
      vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_EMAIL_PER_HOUR', raw);
      expect(authCodePolicies()[0].policy.limit).toBe(5);
    }
  );

  it('keeps every window at least an hour, so a per-minute burst is not the bound', () => {
    for (const { policy } of authCodePolicies()) {
      expect(policy.windowMs).toBeGreaterThanOrEqual(HOUR);
    }
  });
});

describe('enforceAuthCodeRateLimit', () => {
  it('keys on the submitted address, not only the IP', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_EMAIL_PER_HOUR', '1');

    expect(
      await enforceAuthCodeRateLimit(req(), 'auth.email-challenge', 'a@example.com')
    ).toBeNull();

    // A different address from the same (unknown) IP is still fine: only the
    // per-address budget is exhausted.
    expect(
      await enforceAuthCodeRateLimit(req(), 'auth.email-challenge', 'b@example.com')
    ).toBeNull();

    const over = await enforceAuthCodeRateLimit(
      req(),
      'auth.email-challenge',
      'a@example.com'
    );
    expect(over?.status).toBe(429);
  });

  it('keys on the IP as well, so cycling addresses does not help', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_IP_PER_HOUR', '2');
    const headers = { 'x-forwarded-for': '203.0.113.7' };

    expect(
      await enforceAuthCodeRateLimit(
        req(headers),
        'auth.email-challenge',
        'a@example.com'
      )
    ).toBeNull();
    expect(
      await enforceAuthCodeRateLimit(
        req(headers),
        'auth.email-challenge',
        'b@example.com'
      )
    ).toBeNull();

    const over = await enforceAuthCodeRateLimit(
      req(headers),
      'auth.email-challenge',
      'c@example.com'
    );
    expect(over?.status).toBe(429);
  });

  it('is case-insensitive about the address, so casing cannot split a bucket', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_EMAIL_PER_HOUR', '1');

    expect(
      await enforceAuthCodeRateLimit(req(), 'auth.email-challenge', 'a@example.com')
    ).toBeNull();

    const over = await enforceAuthCodeRateLimit(
      req(),
      'auth.email-challenge',
      '  A@Example.COM '
    );
    expect(over?.status).toBe(429);
  });

  it('keeps the three code routes on separate budgets', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_EMAIL_PER_HOUR', '1');

    expect(
      await enforceAuthCodeRateLimit(req(), 'auth.email-challenge', 'a@example.com')
    ).toBeNull();
    expect(
      await enforceAuthCodeRateLimit(req(), 'auth.pin-reset-request', 'a@example.com')
    ).toBeNull();
    expect(
      await enforceAuthCodeRateLimit(req(), 'auth.recovery-initiate', 'a@example.com')
    ).toBeNull();
  });

  it('sets Retry-After on the 429', async () => {
    vi.stubEnv('RATE_LIMIT_AUTH_CODE_PER_EMAIL_PER_HOUR', '1');
    await enforceAuthCodeRateLimit(req(), 'auth.recovery-initiate', 'a@example.com');

    const over = await enforceAuthCodeRateLimit(
      req(),
      'auth.recovery-initiate',
      'a@example.com'
    );
    expect(over?.status).toBe(429);
    expect(Number(over?.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
