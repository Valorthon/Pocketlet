# Agent & Developer Operating Manual

Last reviewed: 2026-09-20

Read this file first. It is the working manual for coding agents and new developers: what the system actually is, which commands work, what the conventions are, and which traps have already cost someone a day.

For product intent read [`docs/product-spec.md`](./docs/product-spec.md); for the system picture read [`docs/architecture.md`](./docs/architecture.md). **If this file contradicts the code, the code wins — fix this file in the same PR.**

## What this is

A deployed passkey-based USDC/XLM wallet on Stellar Testnet. Not a scaffold: ~40 API routes, 5 database tables, a custom Soroban contract, and a live deployment. Feature status lives in the [README table](./README.md#features) — check there before assuming something exists.

## Stack

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces (`apps/*`, `packages/*`), `pnpm@11.13.1`, Node 22+ |
| Frontend + API | Next.js 15.5.25 App Router, React 18, TypeScript 5.7 |
| Styling | Tailwind 3.4 |
| Database | PostgreSQL + Drizzle ORM (`drizzle-orm`, `drizzle-kit`, `pg`) |
| Stellar | `@stellar/stellar-sdk` 16.3, `passkey-kit` 0.16, `sac-sdk` 0.4 |
| Auth | `@simplewebauthn` 14, `jose` (JWT sessions), `bcryptjs` (PIN), `bip39` |
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

Verified against the code on 2026-09-20. These are the things that look wrong, are wrong, or will waste your time.

**Tests need a live database.** `apps/web/vitest.setup.ts` runs `migrate()` at module load and clears tables in `beforeEach`, so without Postgres the whole suite fails at import rather than with a useful message. `DATABASE_URL` is honoured from `apps/web/.env.local` — `apps/web/vitest.env.ts` is listed first in `setupFiles` so dotenv runs before `./src/lib/db` constructs the `pg` Pool at module scope. Keep it first; putting the dotenv call inside `vitest.setup.ts` is always too late, because ES module imports are evaluated before any statement body. (That was issue #58.) `drizzle.config.ts` loads `.env.local` for the same reason.

**Deleting a user can fail, on purpose.** `claim_links.sender_email` references `users.email` with `on delete restrict`, so a user with outstanding claim links cannot be deleted — a claim link is an escrow deposit that may still hold funds on-chain. `user_devices` and `notifications` cascade instead. `src/lib/db/test-setup.ts` truncates all five tables in one statement, so tests no longer leak rows. (That was issue #62.)

**`stellarAddress` is a duplicate column.** `api/wallet/deploy/route.ts:121-124` always sets it equal to `walletContractId`. It is a leftover from the classic-account era, but it is *load-bearing*: `resolveRecipient` reads `stellarAddress` while transfers use `walletContractId`. Don't drop it without changing both.

**The production guardrails live in one `.mjs` file, on purpose.** `next.config.mjs` (build time) and `src/lib/auth/config.ts` (runtime) both call `src/lib/config/production-guardrails.mjs`. It is plain ESM JavaScript rather than TypeScript because Next loads `next.config.mjs` through Node's ESM loader with no transpilation — don't convert it to `.ts`, and don't import `@stellar/stellar-sdk` from it. Add a new check there, not in either caller. (That was issue #57.)

**The escrow expiry unit changes across the boundary.** The contract takes `expiry` as a **ledger sequence**; `claim_links.expiry` in Postgres is a **timestamp**. The conversion is done ad hoc in `api/wallet/claim-links/create/route.ts`.

**Passkey registration needs a server challenge, and the client must ask for one first.** `createPasskeyKit()` with no argument cannot register a passkey — `api/wallet/deploy`, `api/wallet/backup-passkey` and `api/wallet/recovery/submit` reject a response whose challenge they did not issue. Call `fetchPasskeyChallenge()` and pass the result to `createPasskeyKit(challenge)`; it injects the nonce through passkey-kit's `WebAuthn` config point, because `createWallet`/`createKey` otherwise generate their own. Challenges are single-use and expire in five minutes. Registration uses `users.passkey_challenge`, deliberately separate from the `pending_challenge` column the login and Ed25519 flows share. (That was issue #56.)

**Dead code that still looks alive:**
- `/swap` page and `api/wallet/swap` — the route returns HTTP 410, the page is a placeholder, and it's still in the nav.
- `POCKETLET_DATA_DIR` now holds only `fee_payer_secret`, not user data.

**Notifications don't notify.** `src/lib/notifications.ts` `console.log`s and writes the row with `status: 'sent'` without sending anything.

**Lint won't catch React bugs.** The shared ESLint config is base + `typescript-eslint` only — no `eslint-config-next`, no `react-hooks` plugin, despite 25 `'use client'` files. Hook-dependency mistakes get through. Because there is no `eslint-config-next`, `next-env.d.ts` also has to be ignored explicitly in `packages/config/eslint/index.mjs` — Next writes triple-slash references into it and `@typescript-eslint/triple-slash-reference` rejects them.

**`next build` rewrites a tracked file, after lint has already run.** It regenerates `apps/web/next-env.d.ts`. CI's order is lint → typecheck → test → build, so a lint error introduced by the build only shows up on the *next* run. If you change the Next version, run `pnpm run lint` again after `pnpm --filter web build`. Separately, `tsc` caches to `apps/web/tsconfig.tsbuildinfo` (gitignored) and `.next/types` is generated: after switching branches, a typecheck error naming a route that doesn't exist on your branch means a stale artifact, not a real failure — `rm -rf apps/web/.next apps/web/tsconfig.tsbuildinfo`.

**There is a pnpm override on `@simplewebauthn/browser`, and it is load-bearing.** `pnpm-workspace.yaml` forces the whole tree to v14. `passkey-kit` 0.16.2 depends on `@simplewebauthn/browser` as a *regular* dependency, not a peer, so without the override the tree carries two copies that disagree about `RegistrationResponseJSON.response.transports` (`string[]` in 14, a narrow union in 13) — which breaks the `WebAuthn` seam `createPasskeyKit` uses to inject the server challenge, because the kit types that seam against its own copy. Drop the override only when passkey-kit itself depends on 14 (see issue #118).

**Not actually server components.** Despite App Router, essentially everything interactive is `'use client'`.

## Testing expectations

Colocate `*.test.ts` next to the source. Coverage is uneven — the gaps and their tracking issues are in [`docs/production-readiness.md`](./docs/production-readiness.md). Prefer closing those over deepening areas already covered. Rust panics in `contracts/escrow` use bare `#[should_panic]` with no `expected =` string, so a test can pass on the wrong panic; add the string when you touch one. See [`docs/testing.md`](./docs/testing.md).

## Keeping docs true

Each fact has one home; other docs link to it. When you change something, the
["if you change X, update Y" table in `CONTRIBUTING.md`](./CONTRIBUTING.md#if-you-change-x-update-y)
says what to update. It is the only copy — don't start another.
