# Agent & Developer Operating Manual

Last reviewed: 2026-09-17

Read this file first. It is the working manual for coding agents and new developers: what the system actually is, which commands work, what the conventions are, and which traps have already cost someone a day.

For product intent read [`docs/product-spec.md`](./docs/product-spec.md); for the system picture read [`docs/architecture.md`](./docs/architecture.md). **If this file contradicts the code, the code wins — fix this file in the same PR.**

## What this is

A deployed passkey-based USDC/XLM wallet on Stellar Testnet. Not a scaffold: ~40 API routes, 5 database tables, a custom Soroban contract, and a live deployment. Feature status lives in the [README table](./README.md#features) — check there before assuming something exists.

## Stack

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces (`apps/*`, `packages/*`), `pnpm@11.13.1`, Node 22+ |
| Frontend + API | Next.js 14.2.35 App Router, React 18, TypeScript 5.7 |
| Styling | Tailwind 3.4 |
| Database | PostgreSQL + Drizzle ORM (`drizzle-orm`, `drizzle-kit`, `pg`) |
| Stellar | `@stellar/stellar-sdk` 16, `passkey-kit` 0.16, `sac-sdk` 0.4 |
| Auth | `@simplewebauthn` 13, `jose` (JWT sessions), `bcryptjs` (PIN), `bip39` |
| Tests | Vitest 4 (TypeScript), `cargo test` (Rust) |
| Contract | Rust, `soroban-sdk` 27, target `wasm32v1-none`, Stellar CLI 28 |

**Use `pnpm` only** — never `npm`, `yarn`, or `bun`. Target a workspace with `pnpm --filter web <script>`.

## Layout

```
apps/web/src/app/          18 pages + ~40 API routes
apps/web/src/lib/
  auth/                    sessions, PIN, recovery, config guardrails
  wallet/                  passkey-kit, fee payer, balances, transfers, device keys
  db/                      Drizzle schema, client, test reset helper
  contracts/escrow.ts      TypeScript mirror of the Soroban contract
apps/web/drizzle/          SQL migrations (applied at boot by instrumentation.ts)
packages/config/           shared tsconfig / eslint / tailwind
contracts/escrow/src/      the Soroban contract + its 12 unit tests
docs/                      project documentation, index at docs/README.md
.opencode/skills/          vendored Stellar reference docs — consult before designing Stellar work
```

## Commands

```bash
docker compose up -d              # Postgres — required before running or testing
pnpm install
pnpm run dev:web                  # http://localhost:3000
pnpm --filter web test            # Vitest (needs Postgres)
pnpm run lint                     # eslint --max-warnings=0
pnpm run typecheck                # tsc --noEmit
pnpm --filter web db:generate     # generate a migration after editing schema.ts
pnpm --filter web db:studio       # browse data

cd contracts && cargo test        # contract unit tests
cd contracts && stellar contract build   # -> target/wasm32v1-none/release/pocketlet_escrow.wasm
```

Before opening a PR: `pnpm run lint && pnpm run typecheck && pnpm --filter web test`, plus `cargo test` if you touched `contracts/`.

## Conventions

- **TypeScript only. No `any`, no `@ts-ignore`.** The codebase currently holds exactly one `eslint-disable`; keep it that way.
- Styling is Tailwind. Avoid new CSS files unless there's no Tailwind equivalent.
- Keep UI state in hooks/props or server-derived state. Add a global client store only when several pages genuinely share client-only data.
- **Hide blockchain details in normal UI.** Public keys, fees, and crypto jargon belong in the Transaction Details view, not the main flows.
- Commits follow `type(scope): summary` — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the branch model and PR flow.
- Edit `schema.ts`, then run `db:generate`. Never hand-write a migration.
- Server code must not import from `passkey-kit/server` unless an operation truly needs it — that keeps relayer secrets out of the client bundle. Browser code imports `passkey-kit` and `passkey-kit/storage`.
- V1 does not integrate Anchors. SEP-10/24/38 apply only to deferred V2 fiat work.

## Landmines

Verified against the code on 2026-09-17. These are the things that look wrong, are wrong, or will waste your time.

**Tests need a live database, and `.env.local` will not point them at it.** `apps/web/vitest.setup.ts` runs `migrate()` at module load and clears tables in `beforeEach`, so without Postgres the whole suite fails at import. Worse, it calls `config({ path: '.env.local' })` *after* importing `./src/lib/db`, which creates the `pg` Pool at module scope — so by the time dotenv runs, the connection string is already fixed. `DATABASE_URL` from `.env.local` is silently ignored and the hardcoded `localhost:5432` fallback is used. **Export `DATABASE_URL` in the shell** if your database is anywhere else. (Issue #58.)

**Test isolation is partial.** `src/lib/db/test-setup.ts` deletes from `users` and `metrics` only, so `user_devices`, `claim_links` and `notifications` rows leak between tests. It uses `DELETE`, not `TRUNCATE`, so sequences are not reset. There are no foreign keys anywhere in the schema — see the note at the top of `src/lib/db/schema.ts`.

**`stellarAddress` is a duplicate column.** `api/wallet/deploy/route.ts:121-124` always sets it equal to `walletContractId`. It is a leftover from the classic-account era, but it is *load-bearing*: `resolveRecipient` reads `stellarAddress` while transfers use `walletContractId`. Don't drop it without changing both.

**Recipient resolution silently ignores email.** `src/lib/wallet/recipient.ts` handles raw address, phone, and username only — `RecipientType` has no `'email'`. But `users.email` is the primary key and the `/send` placeholder advertises email, so a *registered* user addressed by email falls through to the unregistered branch and gets a claim link instead of a direct transfer.

**The production guardrails are duplicated and drifting.** `next.config.mjs` (build time) validates `CLAIM_SECRET_ENCRYPTION_KEY` but not `FEE_PAYER_SECRET_KEY`. `src/lib/auth/config.ts` (runtime) does the exact reverse. Both check `SESSION_SECRET` and the WebAuthn origin. Change one, change the other.

**The escrow expiry unit changes across the boundary.** The contract takes `expiry` as a **ledger sequence**; `claim_links.expiry` in Postgres is a **timestamp**. The conversion is done ad hoc in `api/wallet/claim-links/create/route.ts`.

**Open security gap:** three copies of `TODO(V1 production): bind the WebAuthn challenge to a server-generated nonce` — `api/wallet/deploy/route.ts:31`, `api/wallet/backup-passkey/route.ts:59`, `api/wallet/recovery/submit/route.ts:157`. Replay protection is incomplete. See [`docs/production-readiness.md`](./docs/production-readiness.md).

**Dead code that still looks alive:**
- `/swap` page and `api/wallet/swap` — the route returns HTTP 410, the page is a placeholder, and it's still in the nav.
- `apps/web/scripts/fix-tests.ts` — a one-off regex codemod over test files, no script entry, no reason to run.
- `apps/web/scripts/import-users-json.ts` — pre-Postgres backfill; the JSON store is gone.
- `POCKETLET_DATA_DIR` now holds only `fee_payer_secret`, not user data.

**Notifications don't notify.** `src/lib/notifications.ts` `console.log`s and writes the row with `status: 'sent'` without sending anything.

**Lint won't catch React bugs.** The shared ESLint config is base + `typescript-eslint` only — no `eslint-config-next`, no `react-hooks` plugin, despite 25 `'use client'` files. Hook-dependency mistakes get through.

**Not actually server components.** Despite App Router, essentially everything interactive is `'use client'`.

## Testing expectations

Colocate `*.test.ts` next to the source. Coverage is uneven — the gaps and their tracking issues are in [`docs/production-readiness.md`](./docs/production-readiness.md). Prefer closing those over deepening areas already covered. Rust panics in `contracts/escrow` use bare `#[should_panic]` with no `expected =` string, so a test can pass on the wrong panic; add the string when you touch one. See [`docs/testing.md`](./docs/testing.md).

## Keeping docs true

Each fact has one home; other docs link to it. When you change something, the
["if you change X, update Y" table in `CONTRIBUTING.md`](./CONTRIBUTING.md#if-you-change-x-update-y)
says what to update. It is the only copy — don't start another.
