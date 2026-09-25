# Production readiness

Last reviewed: 2026-09-25

Everything that stands between the current testnet build and something deployable to the Stellar public network. These are deliberate shortcuts and known defects, not surprises — [`SECURITY.md`](../SECURITY.md) points here so researchers don't re-report them.

Tracking epic: **#25**.

Status key: **Open** — still a gap. **Closed** — resolved, kept for the record.

## Security

### WebAuthn challenge is not bound to a server nonce — Closed

**Issue #56.** Wallet deploy, backup passkey and recovery submit all passed `expectedChallenge: () => true` to `verifyRegistrationResponse`, accepting whatever challenge the browser had generated. A captured registration response could therefore be replayed.

`POST /api/wallet/passkey-challenge` now issues a 32-byte base64url nonce, stored on the user row with a five-minute expiry, and all three routes require it back. `takePasskeyChallenge` clears the nonce as it reads it, using a compare-and-swap on the value rather than a read followed by a blind write, so concurrent requests cannot both spend one.

The client side needed changing too: passkey-kit generates its own challenge inside `createWallet`/`createKey` and `CreateOptions` has no challenge field, so `createPasskeyKit(challenge)` injects a wrapper through the kit's `WebAuthn` configuration point that overwrites the challenge and otherwise delegates to `@simplewebauthn/browser`. Authentication ceremonies are passed through untouched — passkey-kit sets that challenge to the transaction payload and the smart wallet verifies the binding on-chain.

Registration uses `users.passkey_challenge`, separate from the `pending_challenge` column that the Ed25519 and login flows share, so enrolling a backup passkey mid-session cannot clobber an in-flight login. `api/auth/login-verify` also never cleared its challenge after use — the same replay class — and now does.

Covered by `src/lib/auth/passkey-challenge.test.ts` (single-use, expiry, concurrency, isolation) and route tests including an end-to-end replay rejection. The injection wrapper itself is covered by `src/lib/wallet/passkey-kit.test.ts`, which asserts that registration receives the server nonce, that authentication passes through unrewritten, and that a kit built without a challenge does not override the kit's own WebAuthn implementation.

### Email verification codes are returned in API responses — Closed

**Issues #18 and #121.** `api/auth/email-challenge`, `api/auth/pin/reset` and `api/auth/recovery/initiate` all returned the one-time code in the JSON response so the flows worked without a mail server. Anyone who could call an endpoint could verify any address, reset any PIN they had a session for, or complete the first step of recovery for someone else's account.

The code is now emailed and nothing else, on every network, through the `Mailer` seam from #60 — so testnet still works with no API key, because `logMailer` prints the message to stdout. There is deliberately **no** development-only endpoint that reveals a code: that is the same leak wearing a hat. `docs/testing.md` says where to read one instead.

#18 could not ship on its own. Removing the code from the response makes it the only secret protecting email verification and PIN reset, and it was a six-digit code that never expired, counted no wrong guesses, and in two of the three routes came from `Math.random()`. #121 is the rest of the fix:

- **One CSPRNG.** `generateVerificationCode` in `src/lib/auth/verification-code.ts` uses `randomInt` from `node:crypto`. It replaced the two hand-rolled `Math.random()` copies, and `generateRecoveryCode` now delegates to it, so there is exactly one generator for every one-time code in the app.
- **Expiry.** `users.verification_code_expires_at` and `users.pin_reset_code_expires_at`, 15 minutes, matching `RECOVERY_CODE_EXPIRY_MS`. Enforced on verify, not merely recorded.
- **An attempt cap.** Five wrong guesses per issued code, counted in `users.verification_code_attempts` / `users.pin_reset_code_attempts`. Exceeding it **destroys the code**, so the correct code stops working too and the verifier answers 429. Deliberately not the lockout timestamp `recovery_locked_until` gives the recovery flow: a timed lockout would let anyone who knows a victim's address freeze that victim's signup or PIN reset for an hour by guessing wrong on purpose, whereas the remedy here — ask for another code — is itself rate limited.
- **The cap is enforced under a row lock.** All three verifiers — the two above and `verifyRecoveryCode`, which the other two were modelled on — first counted wrong guesses by reading the row, adding one in JavaScript and writing the sum back. Nothing serialised the three steps, and the attacker picks the concurrency: twenty wrong guesses issued in parallel all read the same stale count, all wrote the same number, the cap was never reached and the code was never destroyed. The same twenty issued sequentially killed it on the fifth, which is why every existing test was green. An atomic `coalesce(attempts, 0) + 1 … returning attempts` fixes the counter but not the check, because a constant-time comparison cannot be written as SQL `=`: every request that read the row before the cap landed still had its guess evaluated against a live code. `verifyOneTimeCode` and `verifyRecoveryCode` therefore run the whole read/compare/write inside one transaction behind `SELECT … FOR UPDATE`, and `recordRecoveryAttempt` counts and arms the lockout in a single statement. Covered by `src/lib/auth/attempt-cap.test.ts`, which fires twenty parallel wrong guesses at each of the three and asserts the sequential outcome exactly.
- **Constant-time comparison.** The SHA-256-then-`timingSafeEqual` shape from #61 moved out of `src/lib/admin.ts` into `src/lib/constant-time.ts`; the admin token, the signup code, the PIN reset code and — since the security review of this PR — the recovery code all call the same `constantTimeEquals`. No second implementation. The primitive takes `unknown` and answers `false` for anything that is not a string: route handlers cast a parsed JSON body and hand a field straight to it, and `{"code": 654321}` satisfied the cast, reached `createHash().update(value, 'utf8')` and threw `ERR_INVALID_ARG_TYPE` — a 500 where the answer was a 401. The handlers narrow with `typeof` and answer 400 as well; a security primitive should not be the thing that throws.
- **Rate limits on issuing a code.** `enforceAuthCodeRateLimit` (#36's mechanism, see [ADR 0008](./decisions/0008-fee-payer-rate-limiting.md)) guards all three routes. `email-challenge` and `recovery/initiate` are the app's only genuinely unauthenticated endpoints, so there is no session to key on: the buckets are the **submitted address** and the **client IP**. Defaults are 5 per address per hour, 20 per IP per hour and 100 per IP per day, all overridable — see `RATE_LIMIT_AUTH_CODE_*` in `apps/web/.env.example`. Those two routes charge the limit in halves: the per-IP windows run **before** their existence check (`email-challenge`'s 409 for a verified address, `recovery/initiate`'s 404 for an address with no recoverable account), because that answer is "does this person have a Pocketlet wallet?" and behind the limiter it was free to ask without bound; the per-address window stays after it, so a stranger probing an address cannot spend the budget its owner needs.
- **Rate limits on guessing a code.** The three verifiers — `verify-email`, `pin/reset` (action `reset`) and `recovery/verify` — had none, and `verify-email` is unauthenticated. They now carry `enforceAuthVerifyRateLimit` on separate `RATE_LIMIT_AUTH_VERIFY_*` budgets (20 per address per hour, 60 per IP per hour, 300 per IP per day), so asking for a code and guessing at one do not spend each other. The row-locked attempt cap is the real defence; this is depth. `verify-email` also lost its standalone `getUserByEmail` guard: `verifyEmailVerificationCode` already returns `no-code` for a missing row and the route already mapped that to the same 401, so the lookup bought nothing but a query and an enumeration oracle.
- **A mail failure does not spend the recovery budget.** `recovery/initiate` writes the initiation before attempting delivery — it has to, because the code must be readable by the time it can be in an inbox — so a 502 used to charge the hourly `countRecentInitiations` cap for a code that never arrived. A five-minute provider outage locked a user out of recovery for an hour, after five "try again in a minute" responses. `rollbackRecoveryInitiation` gives the history entry back; the 60-second retry floor is deliberately kept, since that is what the message refers to. `auth.signup.completed` moved for the same reason: it is counted after delivery, not next to `createUser`.
- **A resend path.** `email-challenge` now re-issues for an existing *unverified* row instead of answering 409. Without it, the expiry and the attempt cap would strand a user whose mail was slow, filtered or never arrived with an account they could neither verify nor re-create. A verified address still gets 409.

When mail delivery fails all three routes answer **502** with a message saying so, rather than 200. The user cannot proceed without the code, so "check your email" would send them to a step that can never succeed; and because the stored code is simply unused and asking again overwrites it, nothing inconsistent is left behind. This is the opposite of the claim-link rule in #120 — there the caller has already moved funds on chain, so a mail failure must not surface as an error; here nothing irreversible has happened.

`isRecoveryInitiationRateLimited` is untouched: it encodes recovery-specific semantics (a 60-second minimum retry and the initiation-history column) that the general limiter does not replace.

**Upgrade note: codes issued before this ships stop working.** The expiry and attempt columns are new, and a row written by the old code has a code with a NULL expiry, which every verifier reads as `no-code` and answers 401. Signup is covered by the resend path — `email-challenge` re-issues for an unverified row — and an in-flight recovery can be re-initiated, but a pending **PIN reset must be requested again**; there is no resend for a code the user is already holding. The window is the 15 minutes either side of the deploy.

Covered by `src/lib/auth/verification-code.test.ts`, `src/lib/auth/attempt-cap.test.ts`, `src/lib/constant-time.test.ts`, `src/lib/mail/auth-codes.test.ts`, the `authCodePolicies` and `authVerifyPolicies` blocks in `src/lib/rate-limit.test.ts`, and route tests for all five of `email-challenge`, `verify-email`, `pin/reset`, `recovery/initiate` and `recovery/verify`.

### Production guardrails are duplicated and drifting — Closed

**Issue #57.** The public-network checks existed twice and did not agree. `next.config.mjs` (build time) validated `CLAIM_SECRET_ENCRYPTION_KEY` but not `FEE_PAYER_SECRET_KEY`; `src/lib/auth/config.ts` (runtime) did the reverse. Because `output: 'standalone'` means the build-time copy never re-runs in the deployed container, `CLAIM_SECRET_ENCRYPTION_KEY` was in practice only ever enforced on the build machine.

Both now call `src/lib/config/production-guardrails.mjs`, which enforces the union: `SESSION_SECRET` (presence, not a placeholder, at least 32 characters), an HTTPS `WEBAUTHN_ORIGIN`, a non-`localhost` `WEBAUTHN_RP_ID`, `FEE_PAYER_SECRET_KEY` and `CLAIM_SECRET_ENCRYPTION_KEY`. Two latent bugs went with it: every guarded secret is now rejected if left at an `.env.example` placeholder (previously only `SESSION_SECRET` was), and an empty `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` is treated as unset rather than as "not the public network", which used to switch all guardrails off silently.

The module is plain ESM JavaScript, not TypeScript, because Next loads `next.config.mjs` through Node's ESM loader with no transpilation. It keeps the passphrase as a literal rather than importing `Networks` from `@stellar/stellar-sdk`, so `next build` does not pay for the SDK at config-load time. Covered by `src/lib/config/production-guardrails.test.ts`.

### Admin token comparison is not constant-time — Closed

**Issue #61.** `src/lib/admin.ts` compared the bearer token with `===`, which is theoretically vulnerable to timing analysis. It failed closed when the token was still the `.env.example` default, but silently — `/admin` gave no signal explaining why.

`verifyAdminToken` now compares SHA-256 digests of both sides with `timingSafeEqual`. Hashing first keeps both buffers at a fixed 32 bytes, so the comparison cannot throw on a length mismatch and no length check leaks the secret's size. It returns `{ ok: false, reason: 'unconfigured' | 'invalid' }` instead of a bare boolean: `api/admin/stats` answers an unconfigured token with **503** and an actionable message (which `/admin` already renders verbatim) and logs it server-side, while a wrong token still gets an undifferentiated **401**. Covered by `src/lib/admin.test.ts`.

`ADMIN_SECRET_TOKEN` is still not among the production startup requirements. The reason originally given — that it would have to be added in two drifting places — no longer applies now that #57 is closed; adding it to `src/lib/config/production-guardrails.mjs` is a one-line change. It is left out because it would make a mainnet build fail for a service that may legitimately run without the admin dashboard, which is a product decision rather than a security one.

### Fee payer key handling — Open

**Issue #19.** On testnet, an unset `FEE_PAYER_SECRET_KEY` causes the server to generate a keypair and Friendbot-fund it, storing the secret at `POCKETLET_DATA_DIR/fee_payer_secret` on local disk.

The public network already requires the variable and fails fast without it, so the remaining work is operational: keep it in a secrets manager, not a file, and define a rotation cadence. The fee payer is not a signer on any user wallet, so rotation needs no user action.

### Development-only secrets — Closed

**Issue #23.** The app now fails fast on the public network if `SESSION_SECRET` is default or under 32 characters, if `WEBAUTHN_ORIGIN` is not HTTPS, or if `WEBAUTHN_RP_ID` is `localhost`. `.env.example` still ships dev placeholders, which is correct for a template.

### Server-held wallet signing keys — Closed

**Issue #22.** Owner Ed25519 secrets were once generated server-side and stored in plaintext in `users.json`. The passkey-kit migration removed server-held owner keys entirely; the primary signer is a device passkey and the recovery phrase is generated client-side.

Remaining judgement call before launch: decide a policy on platform-synced versus device-bound passkeys, and whether to offer hardware-wallet or seed-only custody for advanced users.

### On-chain authorization for transfers — Closed

**Issue #21.** The old custom smart wallet's `transfer` did not call `require_auth()`. That contract is gone; authorization is now enforced by the passkey-kit wallet's `__check_auth`, which validates the WebAuthn signature. The PIN remains an application-layer gate.

## Data and delivery

### Email notifications are never delivered — Closed

**Issue #60.** `src/lib/notifications.ts` wrote a `notifications` row with `status: 'sent'` and only `console.log`d, so claim-link recipients were never told a link existed and the feature depended on the sender passing the message along by hand.

Delivery now goes through a `Mailer` seam in `src/lib/mail/`: `resendMailer` posts to Resend's REST endpoint with plain `fetch` (no new dependency — the vendor is meant to be cheap to swap, so the interface carries the weight, not a client library), and `logMailer` writes to stdout and is the default when `RESEND_API_KEY` is unset, which keeps testnet development and the test suite working with no API key. `status` is set from the delivery result: `queued` on insert, then `sent`, `failed` (with `error` and `attempts`) or `unsupported`. The new `attempts`, `error` and `last_attempt_at` columns came with migration `0004_cuddly_alex_power.sql`.

Two properties are load-bearing rather than incidental. `Mailer.send` never throws — every failure, including an unexpected one, is returned as `{ ok: false }` — and `deliverClaimLinkNotification` wraps its whole body, so not even a database error escapes. Together they close the scope **#120** actually specified — its "Fix" section asks for exactly these two things. `api/wallet/claim-links/create` used to attempt the notification inside the same `try` as `submitSignedTransaction`, so a failure there returned 500 on a request whose escrow deposit was already on chain, and `send/page.tsx` dropped the user back on the review step where they could authorize a second deposit for the same payment. Delivery now happens after the response object is built and outside that `try`. Both halves are covered by the route tests, which assert 200 plus a `failed` row with the mailer stubbed to throw.

The notification call was not the only way that route could 500 after submitting, and the rest of that class is **not** fixed here — see the next entry (**#139**).

On the public network a mailer is no longer optional: `production-guardrails.mjs` requires `RESEND_API_KEY` and an `@`-shaped `MAIL_FROM`, because shipping notifications to a console log in production is exactly what that file exists to prevent. Both deploys run the testnet passphrase, so the check does not fire on them.

There is no claim URL, and the email says so. Claiming works by *matching* — `api/wallet/claim-links/pending` selects pending links whose `recipient_email` or `recipient_phone` equals the logged-in user's — so the mail tells the recipient to sign up **with that exact address** rather than to click anything, and it never contains the claim secret.

### A claim link can 500 after its deposit is on chain — Open

**Issue #139.** Narrower than #120 but the same shape, and still live. In `api/wallet/claim-links/create` the `db.insert(schema.claimLinks)` that records the link runs *after* `submitSignedTransaction` and is still inside the `try` whose `catch` returns 500. If that insert fails — the `UNIQUE` constraint on `claim_hash`, a Postgres outage, `.returning()` coming back empty — the escrow deposit exists on chain with no row naming its recipient, its secret or its expiry, and the caller sees a failure. The funds are not lost, but nothing in the app can reach them: `pending` has no row to match, and refund needs the sender to come back through a link record that was never written. The branch's own test *"returns 500 for a duplicate claim hash, after the deposit has been submitted"* pins this behaviour deliberately rather than certifying it.

Fix: out of scope for #60. Ordering a database write against a chain write is a design decision with its own failure modes — insert first and a submit failure leaves a phantom link; write-ahead-then-confirm needs a reconciliation path — so it gets its own PR.

### SMS notifications are never delivered — Open

**Issue #60.** `claim_links.recipient_phone` is real and `pending` matches on it, so a phone recipient gets a claim link and a `notifications` row, but there is no SMS provider behind it. The row is written with `status: 'unsupported'` and `attempts: 0` — deliberately neither `sent` (a lie) nor `failed` (implies a retry would help) — and nothing is attempted. Today the sender has to pass the message along by hand for phone recipients.

Fix: a Twilio (or equivalent) implementation of the `Mailer`-style seam. Out of scope for #60 because it is a new dependency plus 10DLC/A2P brand and campaign registration, which is a procurement task, not a coding one.

### Storage — mostly Closed

**Issue #24.** User records moved from `apps/web/.data/users.json` to PostgreSQL ([ADR 0002](./decisions/0002-postgres-over-file-storage.md)). `apps/web/scripts/import-users-json.ts` was the one-off backfill; it has since been deleted (issue #104).

Still open: the testnet `fee_payer_secret` remains on local disk under `POCKETLET_DATA_DIR`, and belongs in a secrets manager.

### No foreign keys — Closed

**Issue #62.** `user_devices.email`, `claim_links.sender_email`, and `notifications.claim_link_id` had no referential integrity, so orphan rows were possible and deletes did not cascade.

All three are now foreign keys (migration `0002_fuzzy_shaman.sql`). Delete behaviour differs by intent: `user_devices` and `notifications` cascade, because a device signer or a queued notification is meaningless without its parent; `claim_links.sender_email` **restricts**, because a claim link records an escrow deposit that may still hold funds on-chain and must not disappear with its sender. `claim_links.recipient_email` is deliberately not a reference — an unregistered recipient is the whole point of a claim link.

`resetDatabase()` now issues a single `TRUNCATE ... RESTART IDENTITY CASCADE` over all six tables instead of deleting from two, which is order-independent (so the restrict constraint cannot trip it) and faster. Covered by `src/lib/db/schema.test.ts`.

The migration begins with three hand-added `DELETE` statements that sweep pre-existing orphans. Migrations run at boot and at test import, so without them a single leftover row would abort startup — and any database that ran the old `resetDatabase()` is likely to hold some.

## Product

### DEX swaps are disabled — Open

**Issue #20, closed as deferred.** USDC ↔ XLM swaps are off. The passkey-kit smart account cannot authorize classic `PathPayment` operations, and the previous implementation depended on a deleted `mock_dex` contract. The placeholder `/swap` page and the `410` `api/wallet/swap` route were deleted in issue #106 — they were never reachable from the nav, which lists only `/home`, `/receive`, `/transactions`, and `/profile`.

Fix: rebuild around a real Stellar DEX/AMM using SAC or Soroban DEX flows, with quotes, slippage protection, and price-impact display. Scheduled as [Cross-Asset Swaps in V3](./roadmap.md#cross-asset-swaps).

### Email is not a recipient resolution path — Closed

**Issue #59.** `src/lib/wallet/recipient.ts` resolved raw addresses, phone numbers, and usernames, but not email — despite `users.email` being the primary key and the send UI advertising email. A **registered** user addressed by email fell through to the claimable-link branch and got an escrow deposit instead of a direct transfer.

`resolveRecipient` now has an `email` branch that looks the user up with `getUserByEmail` (which normalizes to lowercase, so case does not matter) and returns their `stellarAddress`. The claim-link branch in `api/wallet/resolve` is unchanged and still catches genuinely unregistered emails, plus registered users whose wallet is not deployed yet. `api/wallet/transfer` reads only `resolved.address`, so email transfers work there too.

### `stellar_address` duplicates `wallet_contract_id` — Open

Always set to the same value at `api/wallet/deploy/route.ts:121-124`, but load-bearing: `resolveRecipient` reads one while transfers use the other. Collapsing them is safe only if both call sites change together.

### Rate limiting — Closed

**Issue #36.** The fee-payer submission endpoints had no rate limiting, so any
authenticated user could post signed XDRs in a loop — valid ones or deliberate
on-chain failures — and drain `FEE_PAYER_SECRET_KEY` at the platform's expense.

It was nine routes, not the three the issue named: every path that reaches
`submitSignedTransaction`, namely `api/wallet/{submit,transfer,deploy}`,
`api/wallet/device-key/submit`, `api/wallet/recovery-signer`,
`api/wallet/recovery/submit` and all three of
`api/wallet/claim-links/{create,claim-submit,refund}`. `api/wallet/resolve` is
limited too, on much looser numbers: it spends nothing, but since #110 its
200-vs-404 confirms whether an email, phone or username belongs to a registered
account, so the concern there is enumeration rather than cost.

Counters live in the `rate_limits` table (`src/lib/rate-limit.ts`), one row per
bucket, keyed `"<route>|<kind>|<subject>|<windowMs>"` so per-user, per-IP,
per-route and per-window budgets cannot collide. Each subject gets two fixed
windows: a per-minute one that stops a tight loop and a per-day one that is what
actually bounds the spend. All six limits and the proxy hop count are
environment variables, documented in
[`apps/web/.env.example`](../apps/web/.env.example). Exceeding one returns 429
with a `Retry-After` header.

The four load-bearing decisions — Postgres over an in-memory `Map`, JS
`Date.now()` over SQL `now()`, explicit `enforce()` calls over Edge middleware,
and the rightmost `X-Forwarded-For` entry normalised to a /64 — are recorded
once in [ADR 0008](./decisions/0008-fee-payer-rate-limiting.md). Every limited
route carries its own enforcement test, because the wiring is per route and
deleting one call is otherwise invisible to CI.

Still open, and deliberately out of scope: nothing prunes `rate_limits`, so
expired buckets accumulate. `rate_limits_updated_at_idx` makes a cleanup a cheap
ranged scan; the cleanup itself is **issue #141**.

The session preamble those routes duplicated moved to
`src/lib/auth/route-guard.ts` in the same change — 9 route files were migrated,
15 others still hand-roll it. The differing 404 bodies (`Wallet not deployed` /
`Wallet not found` / `User not found or email not verified`) are passed per
route and unchanged.

`isRecoveryInitiationRateLimited` in `src/lib/auth/recovery.ts` stays as it was.
It is a pure function over a user row with no store behind it, encoding
recovery-specific semantics (a 60-second minimum retry and the initiation
history column) that a generic limiter does not replace; the new limit layers on
top of it rather than replacing it.

## Engineering

### The test suite ignores `DATABASE_URL` from `.env.local` — Closed

**Issue #58.** `apps/web/vitest.setup.ts` called `config({ path: '.env.local' })` *after* importing `./src/lib/db`, which creates the `pg` Pool at module scope. ES module imports are evaluated first, so the connection string was resolved before dotenv ran and the `.env.local` value never applied — the hardcoded `localhost:5432` fallback was used instead. The failure mode was a misleading `password authentication failed` whenever anything else occupied port 5432; it passed in CI only because the service container matches the fallback.

The dotenv call moved to `apps/web/vitest.env.ts`, listed ahead of `vitest.setup.ts` in `setupFiles` so it is evaluated first. `apps/web/drizzle.config.ts` had the same defect and now loads `.env.local` too. dotenv does not override an already-exported variable, so a shell `DATABASE_URL` and CI's job-level env still win.

### Test coverage gaps — Open

**Issue #63.** All five `api/wallet/claim-links/*` routes and `src/lib/wallet/claim-secrets.ts` now have colocated tests, and the eight bare `#[should_panic]` attributes in `contracts/escrow` carry `expected =` strings (#123 tracks replacing the asserts with typed errors). Still open: no component or page tests exist at all — `vitest.config.ts` runs in the `node` environment, so `@vitejs/plugin-react` only supplies the JSX transform and nothing can render; standing them up needs jsdom or happy-dom plus a testing library. No coverage tooling is configured either. Also untested: `auth/session.ts`, `instrumentation.ts`, `db/{index,test-setup}.ts` and `wallet/{assets,network,token,recipient,device-key,claim-link-client}.ts`. Full inventory in [testing.md](./testing.md).

### Lint cannot catch React bugs — Closed

**Issue #105.** The shared ESLint config was base + `typescript-eslint` only, across 24 `'use client'` files, so hook-dependency mistakes and conditional hooks shipped silently.

`packages/config/eslint/index.mjs` now adds `eslint-plugin-react-hooks` 7 (flat `recommended`, with `exhaustive-deps` raised from `warn` to `error`) and `@next/eslint-plugin-next` 15.5.25 (`recommended` + `core-web-vitals`). `eslint-config-next` is deliberately not used: the 15.x line excludes ESLint 10, which this repo already runs, and the 16.x line belongs to the Next 16 migration (#90). The plugins are registered directly instead, which is why the `next-env.d.ts` ignore stays in that file.

No `rules-of-hooks` violations existed. The sweep fixed five `exhaustive-deps` findings and hoisted `StatCard` out of `admin/page.tsx`'s render body (`react-hooks/static-components`). One rule remains off: `react-hooks/set-state-in-effect` flags 12 pre-existing effects across 7 files, each needing its own behaviour-preserving restructure with no component tests behind it (#63). That remaining gap is tracked in **issue #131**.

### No observability — Open

Around 23 raw `console.*` calls with no logging abstraction, no alerting, and no log aggregation. The `metrics` table and `/admin` are the only instrumentation. See [operations.md](./operations.md#monitoring).

### Dead code — Closed

**Issue #106.** Swept: the `/swap` page and its `410` `api/wallet/swap` route (with the test that asserted the 410), `default_ledger_info()` in `contracts/escrow/src/lib.rs` (never called, and pinned to a stale `protocol_version: 20`), `submitSignedTransactionFast` in `src/lib/wallet/submit.ts` (zero callers, and it spent the fee payer — an unguarded tenth spending path) with the `pollTransactionFast` helper only it used, and the unreferenced `fake-indexeddb` devDependency. The two one-off scripts under `apps/web/scripts/` were deleted in issue #104.

### Deploy logic is duplicated — Closed

**Issue #106.** `.github/workflows/cd.yml` now runs `bash ./deploy.sh` instead of re-implementing build, key setup, and deploy inline. The script is the only copy; it writes the deployed address to `$GITHUB_OUTPUT` and the job summary when those variables are set, so the step output and job summary are unchanged.

---

Completed V1 delivery issues (#5, #8–#15, #33 and its phases) are recorded in the closed GitHub issues and in git history; the checklist that used to live here was redundant with both.
