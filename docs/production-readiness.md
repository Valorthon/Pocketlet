# Production readiness

Last reviewed: 2026-09-17

Everything that stands between the current testnet build and something deployable to the Stellar public network. These are deliberate shortcuts and known defects, not surprises — [`SECURITY.md`](../SECURITY.md) points here so researchers don't re-report them.

Tracking epic: **#25**.

Status key: **Open** — still a gap. **Closed** — resolved, kept for the record.

## Security

### WebAuthn challenge is not bound to a server nonce — Open

**Issue #56.** Three flows verify a WebAuthn assertion without binding the challenge to a server-generated nonce: `api/wallet/deploy/route.ts:31`, `api/wallet/backup-passkey/route.ts:59`, `api/wallet/recovery/submit/route.ts:157`. Each carries an identical `TODO(V1 production)`.

Replay protection is incomplete. This is the most serious open item and must be closed before mainnet.

### Email verification codes are returned in API responses — Open

**Issue #18.** Signup and recovery return the verification code in the JSON response so the flows work without a mail server. Anyone who can call the endpoint can verify any address.

Fix: integrate a transactional email provider (Resend, SendGrid, SES) and remove the code from responses.

### Production guardrails are duplicated and drifting — Open

**Issue #57.** The public-network checks exist twice and do not agree. `next.config.mjs` (build time) validates `CLAIM_SECRET_ENCRYPTION_KEY` but not `FEE_PAYER_SECRET_KEY`; `src/lib/auth/config.ts` (runtime) does the reverse. Both cover `SESSION_SECRET` and the WebAuthn settings.

Fix: extract one shared validator used by both.

### Admin token comparison is not constant-time — Open

**Issue #61.** `src/lib/admin.ts:2` compares the bearer token with `===`, which is theoretically vulnerable to timing analysis. It does fail closed when the token is still the `.env.example` default — but silently, with no signal on `/admin` explaining why.

Fix: use `crypto.timingSafeEqual`, and surface a clear error when the token is unconfigured.

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

**Issue #24.** User records moved from `apps/web/.data/users.json` to PostgreSQL ([ADR 0002](./decisions/0002-postgres-over-file-storage.md)). `apps/web/scripts/import-users-json.ts` was the one-off backfill and can be deleted.

Still open: the testnet `fee_payer_secret` remains on local disk under `POCKETLET_DATA_DIR`, and belongs in a secrets manager.

### No foreign keys — Open

**Issue #62.** `user_devices.email`, `claim_links.sender_email`, and `notifications.claim_link_id` have no referential integrity. Orphan rows are possible and deletes don't cascade. This also means test cleanup is incomplete — see [testing.md](./testing.md#conventions).

## Product

### DEX swaps are disabled — Open

**Issue #20.** USDC ↔ XLM swaps are off: the API returns HTTP 410 and `/swap` is a placeholder still present in the nav. The passkey-kit smart account cannot authorize classic `PathPayment` operations, and the previous implementation depended on a deleted `mock_dex` contract.

Fix: rebuild around a real Stellar DEX/AMM using SAC or Soroban DEX flows, with quotes, slippage protection, and price-impact display. Until then, remove the dead nav entry.

### Email is not a recipient resolution path — Open

**Issue #59.** `src/lib/wallet/recipient.ts` resolves raw addresses, phone numbers, and usernames, but not email — despite `users.email` being the primary key and the send UI suggesting email works. A **registered** user addressed by email falls through to the claimable-link branch and gets an escrow deposit instead of a direct transfer.

### `stellar_address` duplicates `wallet_contract_id` — Open

Always set to the same value at `api/wallet/deploy/route.ts:121-124`, but load-bearing: `resolveRecipient` reads one while transfers use the other. Collapsing them is safe only if both call sites change together.

### Rate limiting — Open

**Issue #36.** The fee-payer submission endpoints have no rate limiting. On a public network this is a direct cost-drain vector.

## Engineering

### The test suite ignores `DATABASE_URL` from `.env.local` — Open

**Issue #58.** `apps/web/vitest.setup.ts` calls `config({ path: '.env.local' })` *after* importing `./src/lib/db`, which creates the `pg` Pool at module scope. ES module imports are evaluated first, so the connection string is resolved before dotenv runs, and the `.env.local` value never applies — the hardcoded `localhost:5432` fallback is used instead.

The failure mode is a misleading `password authentication failed` when anything else occupies port 5432. It works in CI only because the service container happens to match the fallback.

Fix: move the `config()` call into a file loaded before the setup module (or use Vitest's `envFile`/`globalSetup`), so the environment is populated before `src/lib/db` is imported.

### Test coverage gaps — Open

**Issue #63.** No component or page tests exist at all, and all five `api/wallet/claim-links/*` routes — the newest, most intricate feature — are untested. Contract tests use bare `#[should_panic]` with no `expected =` string, so a test can pass on the wrong panic. No coverage tooling is configured. Full inventory in [testing.md](./testing.md).

### Lint cannot catch React bugs — Open

The shared ESLint config is base + `typescript-eslint` only: no `eslint-config-next`, no `react-hooks` plugin, across 25 `'use client'` files. Hook-dependency mistakes ship silently.

### No observability — Open

Around 23 raw `console.*` calls with no logging abstraction, no alerting, and no log aggregation. The `metrics` table and `/admin` are the only instrumentation. See [operations.md](./operations.md#monitoring).

### Dead code — Open

`apps/web/scripts/fix-tests.ts` (one-off regex codemod), `apps/web/scripts/import-users-json.ts` (pre-Postgres backfill), the `/swap` route, page, and nav entry, and `default_ledger_info()` in `contracts/escrow/src/lib.rs:191` (never called; the compiler warns on it).

### Deploy logic is duplicated — Open

`contracts/deploy.sh` and the inlined steps in `.github/workflows/cd.yml` do the same thing in two places and can drift.

---

Completed V1 delivery issues (#5, #8–#15, #33 and its phases) are recorded in the closed GitHub issues and in git history; the checklist that used to live here was redundant with both.
