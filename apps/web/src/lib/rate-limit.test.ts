import { describe, it, expect, afterEach, vi } from 'vitest';
import { db, schema } from '@/lib/db';
import {
  consumeRateLimit,
  enforceFeePayerRateLimit,
  enforceResolveRateLimit,
  feePayerPolicies,
  rateLimitBucket,
  resolvePolicies,
} from './rate-limit';

const MINUTE = 60_000;

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
