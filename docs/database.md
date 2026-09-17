# Database

Last reviewed: 2026-09-17

PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/). Schema: `apps/web/src/lib/db/schema.ts`. Migrations: `apps/web/drizzle/`.

## Local setup

```bash
docker compose up -d     # postgres:16-alpine, port 5432
```

`docker-compose.yml` creates database `pocketlet` with user/password `pocketlet`/`pocketlet`, matching the `DATABASE_URL` default. Nothing else is needed — `apps/web/src/instrumentation.ts` applies migrations on startup, in dev and production alike.

```bash
pnpm --filter web db:studio     # browse data in the browser
pnpm --filter web db:generate   # generate a migration after editing schema.ts
pnpm --filter web db:migrate    # apply migrations manually
pnpm --filter web db:push       # push schema without a migration (dev only)
```

**Never hand-write a migration.** Edit `schema.ts`, run `db:generate`, commit both.

## Tables

### `users`

Primary key is `email`. One row per account, holding identity, wallet, PIN, and recovery state together.

| Group | Columns |
| --- | --- |
| Identity | `email` (PK), `email_verified`, `verification_code`, `username` (unique), `phone` (unique) |
| Passkeys | `credential` (jsonb), `backup_credential` (jsonb), `has_backup_passkey`, `primary_passkey_key_id`, `pending_challenge` |
| Wallet | `wallet_contract_id`, `stellar_address` |
| Recovery | `recovery_public_key`, `recovery_phrase_confirmed`, `recovery_code`, `recovery_code_expires_at`, `recovery_initiated_at`, `recovery_verified_at`, `recovery_initiation_history` (jsonb), `recovery_attempts`, `recovery_locked_until` |
| PIN | `pin_hash` (bcrypt), `pin_reset_code` |
| Timestamps | `created_at`, `updated_at` |

> `stellar_address` is **always set equal to `wallet_contract_id`** (`api/wallet/deploy/route.ts:121-124`) — a leftover from the classic-account era. It is still load-bearing: `resolveRecipient` reads `stellar_address` while transfers use `wallet_contract_id`. Don't drop one without updating the other.

After three failed recovery attempts an account is locked via `recovery_locked_until`. To clear it in testing, update that column directly (see [testing.md](./testing.md)).

### `user_devices`

Short-lived Ed25519 device signers, so routine sends need only a PIN.

`id` (uuid PK), `email`, `device_public_key` (unique), `device_name`, `created_at`, `expires_at`, `last_used_at`.

Registration is idempotent per device key. `expires_at` is enforced at login.

### `claim_links`

One row per claimable link. See [architecture.md](./architecture.md#claimable-links).

`id` (uuid PK), `sender_email`, `recipient_phone`, `recipient_email`, `token_contract_id`, `amount` (text, to avoid float drift on `i128`), `claim_hash` (unique), `secret_ciphertext`, `expiry` (timestamptz), `status` (`pending` by default), `tx_hash`, `created_at`, `claimed_at`.

> `expiry` here is a **timestamp**; the contract's `expiry` is a **ledger sequence**. Converted in `api/wallet/claim-links/create/route.ts`.

`secret_ciphertext` is encrypted under `CLAIM_SECRET_ENCRYPTION_KEY`. The plaintext secret is never stored and never reaches the chain — only its SHA-256 hash.

### `notifications`

Delivery attempts for claim links: `id` (uuid PK), `claim_link_id`, `channel`, `recipient`, `status` (`queued` by default), `sent_at`, `created_at`.

> Nothing is actually sent. `src/lib/notifications.ts` logs to the console and writes `status: 'sent'` regardless. Tracked in [production-readiness.md](./production-readiness.md).

### `metrics`

Counters for the admin dashboard. Composite PK `(key, period)`, plus `value` (bigint) and `updated_at`. Incremented through `incrementMetric()` at notable points such as `wallet.deploy.success`.

## Two things to know before writing tests

**There are no foreign keys.** `user_devices.email`, `claim_links.sender_email`, and `notifications.claim_link_id` are plain columns with no referential integrity. Orphan rows are possible, and cascading deletes don't happen.

**Test cleanup is incomplete.** `src/lib/db/test-setup.ts` `resetDatabase()` truncates only `users` and `metrics`, so `user_devices`, `claim_links`, and `notifications` rows **leak between tests**. If you write claim-link or device-key tests, clean up explicitly or extend `resetDatabase()`.

`apps/web/vitest.setup.ts` runs migrations at module load and `resetDatabase()` in `beforeEach`, so the suite needs a live Postgres. See [testing.md](./testing.md).

## History

User records lived in `apps/web/.data/users.json` until the Postgres migration ([ADR 0002](./decisions/0002-postgres-over-file-storage.md)). `apps/web/scripts/import-users-json.ts` was the one-off backfill and is no longer needed. Any doc or comment still pointing at `users.json` is stale.
