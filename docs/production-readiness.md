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

### Email verification codes are returned in API responses — Open

**Issue #18.** Signup and recovery return the verification code in the JSON response so the flows work without a mail server. Anyone who can call the endpoint can verify any address.

Fix: integrate a transactional email provider (Resend, SendGrid, SES) and remove the code from responses.

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

### Notifications are never delivered — Open

**Issue #60.** `src/lib/notifications.ts` writes a `notifications` row with `status: 'sent'` and only `console.log`s. Claim-link recipients are never actually told a link exists, which makes the feature depend on the sender passing the URL along manually.

Fix: wire a real email/SMS provider and set `status` from the delivery result.

### Storage — mostly Closed

**Issue #24.** User records moved from `apps/web/.data/users.json` to PostgreSQL ([ADR 0002](./decisions/0002-postgres-over-file-storage.md)). `apps/web/scripts/import-users-json.ts` was the one-off backfill; it has since been deleted (issue #104).

Still open: the testnet `fee_payer_secret` remains on local disk under `POCKETLET_DATA_DIR`, and belongs in a secrets manager.

### No foreign keys — Closed

**Issue #62.** `user_devices.email`, `claim_links.sender_email`, and `notifications.claim_link_id` had no referential integrity, so orphan rows were possible and deletes did not cascade.

All three are now foreign keys (migration `0002_fuzzy_shaman.sql`). Delete behaviour differs by intent: `user_devices` and `notifications` cascade, because a device signer or a queued notification is meaningless without its parent; `claim_links.sender_email` **restricts**, because a claim link records an escrow deposit that may still hold funds on-chain and must not disappear with its sender. `claim_links.recipient_email` is deliberately not a reference — an unregistered recipient is the whole point of a claim link.

`resetDatabase()` now issues a single `TRUNCATE ... RESTART IDENTITY CASCADE` over all five tables instead of deleting from two, which is order-independent (so the restrict constraint cannot trip it) and faster. Covered by `src/lib/db/schema.test.ts`.

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

### Rate limiting — Open

**Issue #36.** The fee-payer submission endpoints have no rate limiting. On a public network this is a direct cost-drain vector.

## Engineering

### The test suite ignores `DATABASE_URL` from `.env.local` — Closed

**Issue #58.** `apps/web/vitest.setup.ts` called `config({ path: '.env.local' })` *after* importing `./src/lib/db`, which creates the `pg` Pool at module scope. ES module imports are evaluated first, so the connection string was resolved before dotenv ran and the `.env.local` value never applied — the hardcoded `localhost:5432` fallback was used instead. The failure mode was a misleading `password authentication failed` whenever anything else occupied port 5432; it passed in CI only because the service container matches the fallback.

The dotenv call moved to `apps/web/vitest.env.ts`, listed ahead of `vitest.setup.ts` in `setupFiles` so it is evaluated first. `apps/web/drizzle.config.ts` had the same defect and now loads `.env.local` too. dotenv does not override an already-exported variable, so a shell `DATABASE_URL` and CI's job-level env still win.

### Test coverage gaps — Open

**Issue #63.** No component or page tests exist at all, and all five `api/wallet/claim-links/*` routes — the newest, most intricate feature — are untested. Contract tests use bare `#[should_panic]` with no `expected =` string, so a test can pass on the wrong panic. No coverage tooling is configured. Full inventory in [testing.md](./testing.md).

### Lint cannot catch React bugs — Open

The shared ESLint config is base + `typescript-eslint` only: no `eslint-config-next`, no `react-hooks` plugin, across 25 `'use client'` files. Hook-dependency mistakes ship silently.

### No observability — Open

Around 23 raw `console.*` calls with no logging abstraction, no alerting, and no log aggregation. The `metrics` table and `/admin` are the only instrumentation. See [operations.md](./operations.md#monitoring).

### Dead code — Closed

**Issue #106.** Swept: the `/swap` page and its `410` `api/wallet/swap` route (with the test that asserted the 410), `default_ledger_info()` in `contracts/escrow/src/lib.rs` (never called, and pinned to a stale `protocol_version: 20`), `submitSignedTransactionFast` in `src/lib/wallet/submit.ts` (zero callers, and it spent the fee payer — an unguarded tenth spending path) with the `pollTransactionFast` helper only it used, and the unreferenced `fake-indexeddb` devDependency. The two one-off scripts under `apps/web/scripts/` were deleted in issue #104.

### Deploy logic is duplicated — Closed

**Issue #106.** `.github/workflows/cd.yml` now runs `bash ./deploy.sh` instead of re-implementing build, key setup, and deploy inline. The script is the only copy; it writes the deployed address to `$GITHUB_OUTPUT` and the job summary when those variables are set, so the step output and job summary are unchanged.

---

Completed V1 delivery issues (#5, #8–#15, #33 and its phases) are recorded in the closed GitHub issues and in git history; the checklist that used to live here was redundant with both.
