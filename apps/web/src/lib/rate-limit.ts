import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { getClientIp } from '@/lib/client-ip';

const { rateLimits } = schema;

/**
 * Fixed-window rate limiting for the endpoints that spend fee-payer funds.
 *
 * Every route that reaches `submitSignedTransaction` has the platform pay the
 * Stellar fee, so an authenticated user who posts signed XDRs in a loop — valid
 * ones or deliberate on-chain failures — drains `FEE_PAYER_SECRET_KEY` at the
 * platform's expense (issue #36).
 *
 * Three design points worth knowing before changing anything here:
 *
 * 1. **The counter lives in Postgres.** An in-memory `Map` resets on every
 *    deploy and every restart of the single Railway container, so it cannot
 *    bound spend over any interesting period.
 *
 * 2. **Time comes from JS `Date.now()`, never SQL `now()`.** `vi.useFakeTimers`
 *    controls the former and not the database clock; a SQL-clock limiter is
 *    untestable, and untestable rate limiting is indistinguishable from none.
 *
 * 3. **Enforcement is an explicit call, not middleware.** Next 15 middleware is
 *    Edge-by-default, where `pg` and `drizzle-orm` cannot run (they are already
 *    `serverExternalPackages` in `next.config.mjs`), and — more importantly —
 *    middleware runs before the handler and so cannot tell whether a request
 *    will actually reach the fee payer. Routes call `enforceFeePayerRateLimit`
 *    immediately before `submitSignedTransaction`, so a request rejected by
 *    validation costs the caller nothing: we count the expensive thing, not
 *    merely the request.
 */

/** One route that spends fee-payer funds. Used as the bucket's first segment. */
export type FeePayerRoute =
  | 'wallet.submit'
  | 'wallet.transfer'
  | 'wallet.deploy'
  | 'wallet.device-key.submit'
  | 'wallet.recovery-signer'
  | 'wallet.recovery.submit'
  | 'wallet.claim-links.create'
  | 'wallet.claim-links.claim-submit'
  | 'wallet.claim-links.refund';

/** Routes that are cheap to serve but worth limiting for other reasons. */
export type LooseRoute = 'wallet.resolve';

export type RateLimitedRoute = FeePayerRoute | LooseRoute;

export type SubjectKind = 'user' | 'ip';

export interface RateLimitPolicy {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the offending window rolls over. At least 1. */
  retryAfterSeconds: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Read a positive integer from the environment.
 *
 * Read per call rather than at module load so that tests (and a restart-free
 * config change) see the current value. A missing, unparseable or non-positive
 * value falls back to the default: a limit of 0 would lock every user out of
 * their own wallet, which is a worse failure than a limit that is too high.
 */
function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/**
 * Policies for the fee-payer routes, strictest first.
 *
 * Two windows per subject on purpose. The per-minute window stops a tight loop;
 * the per-day window is what actually bounds the spend, because a burst limit
 * alone still permits five figures of transactions a day.
 */
export function feePayerPolicies(): Array<{
  kind: SubjectKind;
  policy: RateLimitPolicy;
}> {
  return [
    {
      kind: 'user',
      policy: {
        limit: positiveIntFromEnv(
          process.env.RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE,
          10
        ),
        windowMs: MINUTE_MS,
      },
    },
    {
      kind: 'user',
      policy: {
        limit: positiveIntFromEnv(
          process.env.RATE_LIMIT_FEE_PAYER_PER_USER_PER_DAY,
          100
        ),
        windowMs: DAY_MS,
      },
    },
    {
      kind: 'ip',
      policy: {
        limit: positiveIntFromEnv(
          process.env.RATE_LIMIT_FEE_PAYER_PER_IP_PER_MINUTE,
          20
        ),
        windowMs: MINUTE_MS,
      },
    },
    {
      kind: 'ip',
      policy: {
        limit: positiveIntFromEnv(
          process.env.RATE_LIMIT_FEE_PAYER_PER_IP_PER_DAY,
          200
        ),
        windowMs: DAY_MS,
      },
    },
  ];
}

/**
 * Policies for `api/wallet/resolve`.
 *
 * It spends no fee-payer funds, so cost is not the concern; its 200-vs-404
 * answer confirms whether an email, phone or username belongs to a registered
 * account, so the concern is enumeration. A limit loose enough to be invisible
 * to someone typing a recipient still turns a directory scrape into a crawl.
 */
export function resolvePolicies(): Array<{
  kind: SubjectKind;
  policy: RateLimitPolicy;
}> {
  return [
    {
      kind: 'user',
      policy: {
        limit: positiveIntFromEnv(
          process.env.RATE_LIMIT_RESOLVE_PER_USER_PER_MINUTE,
          60
        ),
        windowMs: MINUTE_MS,
      },
    },
    {
      kind: 'ip',
      policy: {
        limit: positiveIntFromEnv(
          process.env.RATE_LIMIT_RESOLVE_PER_IP_PER_MINUTE,
          120
        ),
        windowMs: MINUTE_MS,
      },
    },
  ];
}

/**
 * Build a bucket key.
 *
 * Three segments joined by '|': the route, the subject kind, and the subject
 * itself. The window length is appended so that the two windows of the same
 * subject keep separate counters. No segment can contain '|' — route names are
 * literals from the unions above, kinds are 'user' or 'ip', emails and IPs
 * cannot contain it — so distinct inputs cannot collide on one key.
 */
export function rateLimitBucket(
  route: RateLimitedRoute,
  kind: SubjectKind,
  subject: string,
  windowMs: number
): string {
  return `${route}|${kind}|${subject}|${windowMs}`;
}

/**
 * Count one request against a bucket and say whether it is allowed.
 *
 * A single atomic upsert: on conflict the statement either increments the
 * count, or — when the stored window has elapsed — resets it to 1 and moves the
 * window forward. Doing both branches in one statement means two concurrent
 * requests cannot both observe a stale window and both reset the counter.
 *
 * A rejected request still increments the counter. That is harmless for a fixed
 * window (the reset is driven by the clock, not by the count) and keeps this to
 * one round trip.
 */
export async function consumeRateLimit(
  bucket: string,
  policy: RateLimitPolicy,
  now: number = Date.now()
): Promise<RateLimitDecision> {
  const windowFloor = now - policy.windowMs;

  const [row] = await db
    .insert(rateLimits)
    .values({
      bucket,
      windowStart: now,
      count: 1,
      updatedAt: new Date(now),
    })
    .onConflictDoUpdate({
      target: rateLimits.bucket,
      set: {
        count: sql`case when ${rateLimits.windowStart} <= ${windowFloor} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${rateLimits.windowStart} <= ${windowFloor} then ${now} else ${rateLimits.windowStart} end`,
        updatedAt: new Date(now),
      },
    })
    .returning({
      count: rateLimits.count,
      windowStart: rateLimits.windowStart,
    });

  const windowEnds = Number(row.windowStart) + policy.windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEnds - now) / 1000));

  return { allowed: Number(row.count) <= policy.limit, retryAfterSeconds };
}

/** The 429 body and headers, identical for every limited route. */
function tooManyRequests(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    {
      error:
        'Too many requests. Please wait a moment and try again.',
      retryAfterSeconds,
    },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  );
}

interface EnforceInput {
  request: { headers: Headers };
  route: RateLimitedRoute;
  /** Identifies the account. Normalised to lower case so casing cannot split a bucket. */
  email: string;
  policies: Array<{ kind: SubjectKind; policy: RateLimitPolicy }>;
}

/**
 * Apply every policy in order, returning a 429 response for the first one
 * exceeded and `null` when the caller may proceed.
 *
 * Evaluation stops at the first rejection, so the looser windows are not
 * charged for a request that was already refused.
 */
async function enforce({
  request,
  route,
  email,
  policies,
}: EnforceInput): Promise<NextResponse | null> {
  const now = Date.now();
  const subjects: Record<SubjectKind, string> = {
    user: email.trim().toLowerCase(),
    ip: getClientIp(request),
  };

  for (const { kind, policy } of policies) {
    const decision = await consumeRateLimit(
      rateLimitBucket(route, kind, subjects[kind], policy.windowMs),
      policy,
      now
    );
    if (!decision.allowed) {
      return tooManyRequests(decision.retryAfterSeconds);
    }
  }

  return null;
}

/**
 * Charge one fee-payer submission against the caller's per-user and per-IP
 * budgets. Call this immediately before `submitSignedTransaction`, never at the
 * top of the handler — everything the route rejects first must stay free.
 *
 * Returns a ready-to-return 429 `NextResponse`, or `null` to proceed.
 */
export async function enforceFeePayerRateLimit(
  request: { headers: Headers },
  route: FeePayerRoute,
  email: string
): Promise<NextResponse | null> {
  return enforce({ request, route, email, policies: feePayerPolicies() });
}

/** The looser limit for `api/wallet/resolve`. See {@link resolvePolicies}. */
export async function enforceResolveRateLimit(
  request: { headers: Headers },
  email: string
): Promise<NextResponse | null> {
  return enforce({
    request,
    route: 'wallet.resolve',
    email,
    policies: resolvePolicies(),
  });
}
