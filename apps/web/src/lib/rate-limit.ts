import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { getClientIp } from '@/lib/client-ip';

const { rateLimits } = schema;

/**
 * Fixed-window rate limiting.
 *
 * Three families of route use it: the ones that spend fee-payer funds, the
 * recipient-resolution endpoint, and — since issues #18 and #121 — the three
 * that email a one-time code.
 *
 * Every route that reaches `submitSignedTransaction` has the platform pay the
 * Stellar fee, so an authenticated user who posts signed XDRs in a loop — valid
 * ones or deliberate on-chain failures — drains `FEE_PAYER_SECRET_KEY` at the
 * platform's expense (issue #36).
 *
 * Four things here are deliberate and easy to undo by accident: the counter
 * lives in Postgres rather than an in-memory `Map`, the window clock is JS
 * `Date.now()` and never SQL `now()`, enforcement is an explicit call in each
 * handler rather than Edge middleware, and the client IP is the *rightmost*
 * `X-Forwarded-For` entry. The reasoning for all four is in
 * [ADR 0008](../../../../docs/decisions/0008-fee-payer-rate-limiting.md) — read it
 * before changing any of them.
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

/**
 * The three routes that email a one-time code (issues #18, #121).
 *
 * `auth.email-challenge` and `auth.recovery-initiate` are the only genuinely
 * unauthenticated endpoints in the app, so there is no session to key on.
 */
export type AuthCodeRoute =
  | 'auth.email-challenge'
  | 'auth.pin-reset-request'
  | 'auth.recovery-initiate';

export type RateLimitedRoute = FeePayerRoute | LooseRoute | AuthCodeRoute;

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
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Read a positive integer from the environment.
 *
 * Read per call rather than at module load so that tests (and a restart-free
 * config change) see the current value. A missing, unparseable or non-positive
 * value falls back to the default: a limit of 0 would lock every user out of
 * their own wallet, which is a worse failure than a limit that is too high.
 *
 * `Number`, not `Number.parseInt`. `parseInt` stops at the first character it
 * cannot use, so it turns '1e4' into 1 and '100x' into 100 — silently
 * producing the near-total lockout this function exists to prevent. `Number`
 * rejects both spellings of nonsense outright ('100x' is NaN) while still
 * reading '1e4' as the 10000 the operator meant.
 */
function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
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
    // The per-IP defaults are ~5x the per-user ones. The per-user cap is the
    // real bound on spend; this is only a backstop against one actor working
    // several accounts. At 2x, three ordinary users behind one household,
    // office or CGNAT egress exhausted the shared budget before any of them
    // reached their own entitlement — and one abuser on that egress could 429
    // everybody else behind it for the day. Widening is safe because
    // `normalizeIpForBucket` keys IPv6 on the /64, so an attacker cannot
    // rotate addresses into fresh buckets.
    {
      kind: 'ip',
      policy: {
        limit: positiveIntFromEnv(
          process.env.RATE_LIMIT_FEE_PAYER_PER_IP_PER_MINUTE,
          50
        ),
        windowMs: MINUTE_MS,
      },
    },
    {
      kind: 'ip',
      policy: {
        limit: positiveIntFromEnv(
          process.env.RATE_LIMIT_FEE_PAYER_PER_IP_PER_DAY,
          500
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
 * Policies for the three routes that email a one-time code.
 *
 * These send mail rather than spend Stellar fees, and since issue #18 the code
 * is *only* in that mail — so an unlimited endpoint is both a way to flood a
 * third party's inbox at our expense and, for `auth.email-challenge` and
 * `auth.recovery-initiate`, an unauthenticated one.
 *
 * The window is an hour, not a minute: nobody legitimately needs six signup
 * codes in an hour, and a per-minute cap alone would still permit hundreds of
 * messages a day to one address. The per-day IP window is what bounds the mail
 * bill for an attacker who is patient.
 *
 * The 'user' subject is the **submitted** email on the unauthenticated routes
 * — the address that would be mailed — rather than a session identity, which
 * is the thing that actually needs protecting. The per-IP windows are the
 * backstop for an attacker cycling addresses, and the reason the per-email cap
 * can stay tight: an attacker who changes the address every request gets a
 * fresh email bucket but the same IP bucket.
 */
export function authCodePolicies(): Array<{
  kind: SubjectKind;
  policy: RateLimitPolicy;
}> {
  return [
    {
      kind: 'user',
      policy: {
        limit: positiveIntFromEnv(
          process.env.RATE_LIMIT_AUTH_CODE_PER_EMAIL_PER_HOUR,
          5
        ),
        windowMs: HOUR_MS,
      },
    },
    {
      kind: 'ip',
      policy: {
        limit: positiveIntFromEnv(
          process.env.RATE_LIMIT_AUTH_CODE_PER_IP_PER_HOUR,
          20
        ),
        windowMs: HOUR_MS,
      },
    },
    {
      kind: 'ip',
      policy: {
        limit: positiveIntFromEnv(
          process.env.RATE_LIMIT_AUTH_CODE_PER_IP_PER_DAY,
          100
        ),
        windowMs: DAY_MS,
      },
    },
  ];
}

/**
 * Build a bucket key.
 *
 * Four segments joined by '|': the route, the subject kind, the subject itself
 * and the window length in milliseconds. The window is part of the key so that
 * the per-minute and per-day budgets of one subject keep separate counters. No
 * segment can contain '|' — route names are literals from the unions above,
 * kinds are 'user' or 'ip', emails and IP bucket keys cannot contain it — so
 * distinct inputs cannot collide on one key.
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

/**
 * The 429 body and headers, identical for every limited route.
 *
 * The message branches on how long the caller actually has to wait. "Please
 * wait a moment" alongside a `Retry-After` of 86400 is a lie, and the client
 * has nothing else to go on: the minute window can never ask for more than 60
 * seconds, so anything above that is the daily budget talking.
 */
function tooManyRequests(retryAfterSeconds: number): NextResponse {
  const error =
    retryAfterSeconds > 60
      ? 'Too many requests. You have reached the daily limit for this action; please try again later.'
      : 'Too many requests. Please wait a moment and try again.';

  return NextResponse.json(
    { error, retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  );
}

interface EnforceInput {
  request: { headers: Headers };
  route: RateLimitedRoute;
  /**
   * Identifies the subject: the session's account on the authenticated routes,
   * the submitted address on the unauthenticated code-email ones. Normalised
   * to lower case so casing cannot split a bucket.
   */
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
 * budgets. Call it at the last point before the request gets expensive —
 * immediately before `submitSignedTransaction`, or before `takePasskeyChallenge`
 * where a route has one, since that burns a single-use nonce as it reads it.
 * Never at the top of the handler: everything the route rejects first must stay
 * free.
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

/**
 * Charge one one-time-code email against the submitted address's and the
 * caller's budgets. See {@link authCodePolicies}.
 *
 * Call it immediately before the code is generated and mailed, after every
 * validation the route does — a malformed address, an already-registered one
 * or an ineligible account costs nothing and must stay free, exactly as for
 * the fee-payer routes.
 */
export async function enforceAuthCodeRateLimit(
  request: { headers: Headers },
  route: AuthCodeRoute,
  email: string
): Promise<NextResponse | null> {
  return enforce({ request, route, email, policies: authCodePolicies() });
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
