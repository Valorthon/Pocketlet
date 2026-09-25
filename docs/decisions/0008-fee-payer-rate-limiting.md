# 0008. Postgres-backed, explicitly-called rate limiting for the fee-payer routes

Status: Accepted
Date: 2026-09-25

## Context

[ADR 0003](./0003-fee-payer-resubmission.md) put a server-held account behind every user transaction: the platform pays the Stellar fee for operations the user has already authorized. That is what lets a user hold only USDC, and it is also a spend vector. Nine routes reach `submitSignedTransaction` — `api/wallet/{submit,transfer,deploy}`, `api/wallet/device-key/submit`, `api/wallet/recovery-signer`, `api/wallet/recovery/submit`, and all three of `api/wallet/claim-links/{create,claim-submit,refund}` — and until issue #36 none of them was limited. An authenticated user posting signed XDRs in a loop, valid ones or deliberate on-chain failures, drained `FEE_PAYER_SECRET_KEY`.

`api/wallet/resolve` has a different problem with the same shape. It spends nothing, but since #110 its 200-vs-404 answer confirms whether an email, phone number or username belongs to a registered account, which makes it a user-directory oracle for anyone holding a session.

The constraints that shaped the answer: the app is a **single Railway container** with a Postgres attached; the test suite runs against a real database and drives time with `vi.useFakeTimers`; and Railway's edge proxy **appends** the socket peer address to any `X-Forwarded-For` the client sent.

## Decision

Fixed-window counters in a `rate_limits` table, charged by an explicit call in each handler. Four parts of that are load-bearing.

### 1. The counter lives in Postgres, not an in-memory `Map`

One container, so an in-memory map would at least be coherent — but it resets on every deploy and every `ON_FAILURE` restart, which is theatre for something whose job is bounding spend over a day. Postgres also means one implementation with no development/production divergence, and the atomic upsert (increment, or reset-and-move-the-window, in a single statement) is race-free without any application-level locking.

The cost is one round trip per limited request. It is charged only for requests that are about to cost a Stellar fee, so it is noise beside the RPC calls that follow.

### 2. Window timestamps come from JS `Date.now()`, never SQL `now()`

`window_start` is epoch milliseconds in a `bigint`, not a `timestamp` column defaulted from `now()`. `vi.useFakeTimers` controls the JS clock and not the database clock, so a SQL-clock limiter could not be tested at all — and untestable rate limiting is indistinguishable from none.

### 3. Enforcement is an explicit call in each handler, not Edge middleware

There is no `src/middleware.ts` and there should not be one for this. Next 15 middleware is Edge-by-default, where `pg` and `drizzle-orm` cannot run — they are already listed in `serverExternalPackages` in `next.config.mjs`. More importantly, middleware runs *before* the handler, so it cannot know whether a request will actually reach the fee payer.

Routes therefore call `enforceFeePayerRateLimit` at the last point before the expensive or state-consuming step: immediately before `submitSignedTransaction`, and — in `api/wallet/deploy` and `api/wallet/recovery/submit` — before `takePasskeyChallenge`, which burns a single-use nonce as it reads it. Everything above that line is validation and stays free. The limiter counts the expensive thing, not merely the request.

The price is that the wiring is per route and can be deleted from one without the others noticing, so every limited route carries its own enforcement test.

### 4. The client IP is the rightmost `X-Forwarded-For` entry, normalised to a /64

`NextRequest.ip` was removed in Next 15, so the header is the only source. Railway's edge appends the peer address, so a request from 198.51.100.9 carrying `X-Forwarded-For: 1.2.3.4` arrives as `1.2.3.4, 198.51.100.9`: the client controls everything to the *left*. `split(',')[0]` — the usual reflex — hands the attacker a fresh bucket per request and defeats the limiter entirely. `TRUSTED_PROXY_HOP_COUNT` (default 0) counts back from the right, one per additional reverse proxy.

IPv6 is then collapsed to its **/64 prefix** before keying. Residential and mobile ISPs delegate a /64 — 2^64 addresses — to a single subscriber, so keying on the full address would let a client source each request from a fresh address in its own prefix and never bind. IPv4 keys on the full address; an IPv4-mapped IPv6 address (`::ffff:1.2.3.4`) keys as the IPv4 address it carries, so one client cannot get two buckets by changing spelling.

This design **assumes a proxy that appends**. With no such proxy the whole header is client-supplied and the rightmost entry is attacker-chosen, while honest clients send no header at all and share one `unknown` bucket. That is the local-development situation, and its consequence is that a single developer can exhaust the per-IP daily budget for the whole environment. Raise the limits locally; do not "fix" it by reading the left-hand entry.

## Consequences

Each subject gets two windows per route: per-minute, which stops a tight loop, and per-day, which is what actually bounds the spend. All limits are environment variables documented in [`apps/web/.env.example`](../../apps/web/.env.example), and the bucket key is `"<route>|<kind>|<subject>|<windowMs>"`.

The per-user cap is the real bound on spend. The per-IP cap is a backstop against one actor working several accounts, and its defaults are about five times the per-user ones, because a household, office or CGNAT egress legitimately carries several accounts and a tighter shared cap would let one abuser 429 everybody behind that address. Widening it is only safe because of the /64 normalisation above.

Exceeding a limit returns 429 with a `Retry-After` header, and the message distinguishes a short window from the daily one so the client can say something true.

Nothing prunes `rate_limits`, so expired buckets accumulate. `rate_limits_updated_at_idx` exists so that a cleanup can be a ranged scan; the cleanup itself is **issue #141**.

A limit of 0 would lock users out of their own wallets, so an unset, non-integer or non-positive environment value falls back to the default rather than being honoured.

`isRecoveryInitiationRateLimited` in `src/lib/auth/recovery.ts` is untouched and stays. It is a pure function over a user row encoding recovery-specific semantics (a 60-second minimum retry, and the initiation-history column), not a general limiter; the new limit layers on top of it.

## Alternatives considered

**An in-memory `Map` or LRU** — cheapest, and genuinely coherent on one container, but it forgets everything on deploy. Rejected above.

**Redis** — the standard answer, and the right one at multi-instance scale. Rejected for now: it is another service to run, fund and monitor for a workload that fits in a table the app already has, and Railway gives us the Postgres for free.

**Edge middleware** — rejected on both counts in decision 3: the runtime cannot reach the database, and the placement cannot distinguish cheap requests from expensive ones.

**A sliding window or token bucket** — more accurate, and it removes the 2x burst possible across a fixed-window boundary. Rejected as unnecessary: the per-day window bounds the total spend regardless of how the minute windows line up, and the fixed window is one row and one statement.

**Fail open on a database outage** — rejected. The limiter throws and the request 500s, which is the correct outcome: every route it guards needs the same database later in the request anyway, so failing open would buy nothing but an unbounded fee-payer spend during an outage.
