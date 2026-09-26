# Agent & Developer Operating Manual

Last reviewed: 2026-09-26

Read this file first. It is the working manual for coding agents and new developers: what the system actually is, which commands work, what the conventions are, and which traps have already cost someone a day.

For product intent read [`docs/product-spec.md`](./docs/product-spec.md); for the system picture read [`docs/architecture.md`](./docs/architecture.md). **If this file contradicts the code, the code wins — fix this file in the same PR.**

## What this is

A deployed passkey-based USDC/XLM wallet on Stellar Testnet. Not a scaffold: ~37 API routes, 6 database tables, a custom Soroban contract, and a live deployment. Feature status lives in the [README table](./README.md#features) — check there before assuming something exists.

## Stack

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces (`apps/*`, `packages/*`), `pnpm@11.13.1`, Node 22+ |
| Frontend + API | Next.js 15.5.25 App Router, React 18, TypeScript 6.0 |
| Styling | Tailwind 3.4 |
| Database | PostgreSQL + Drizzle ORM (`drizzle-orm`, `drizzle-kit`, `pg`) |
| Stellar | `@stellar/stellar-sdk` 16.3, `passkey-kit` 0.19, `sac-sdk` 0.4 |
| Auth | `@simplewebauthn` 14, `jose` (JWT sessions), `bcryptjs` (PIN), `bip39` |
| Tests | Vitest 5 (TypeScript), `cargo test` (Rust) |
| Contract | Rust, `soroban-sdk` 27, target `wasm32v1-none`, Stellar CLI 28 |

**Use `pnpm` only** — never `npm`, `yarn`, or `bun`. Target a workspace with `pnpm --filter web <script>`.

## Layout

```
apps/web/src/app/          17 pages + ~37 API routes
apps/web/src/lib/
  auth/                    sessions, PIN, recovery, config guardrails, route-guard
  wallet/                  passkey-kit, fee payer, balances, transfers, device keys
  db/                      Drizzle schema, client, test reset helper
  rate-limit.ts            fee-payer / resolve rate limiting (Postgres-backed)
  client-ip.ts             X-Forwarded-For handling behind Railway's proxy
  contracts/escrow.ts      TypeScript mirror of the Soroban contract
apps/web/drizzle/          SQL migrations (applied at boot by instrumentation.ts)
packages/config/           shared tsconfig / eslint / tailwind
contracts/escrow/src/      the Soroban contract + its 13 unit tests
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

Verified against the code on 2026-09-25. These are the things that look wrong, are wrong, or will waste your time.

**Tests need a live database.** `apps/web/vitest.setup.ts` runs `migrate()` at module load and clears tables in `beforeEach`, so without Postgres the whole suite fails at import rather than with a useful message. `DATABASE_URL` is honoured from `apps/web/.env.local` — `apps/web/vitest.env.ts` is listed first in `setupFiles` so dotenv runs before `./src/lib/db` constructs the `pg` Pool at module scope. Keep it first; putting the dotenv call inside `vitest.setup.ts` is always too late, because ES module imports are evaluated before any statement body. (That was issue #58.) `drizzle.config.ts` loads `.env.local` for the same reason.

**Deleting a user can fail, on purpose.** `claim_links.sender_email` references `users.email` with `on delete restrict`, so a user with outstanding claim links cannot be deleted — a claim link is an escrow deposit that may still hold funds on-chain. `user_devices` and `notifications` cascade instead. `src/lib/db/test-setup.ts` truncates all six tables in one statement, so tests no longer leak rows. (That was issue #62.) Any table you add joins that list — `rate_limits` especially, since a leaked counter makes the suite order-dependent.

**`stellarAddress` is a duplicate column.** `api/wallet/deploy/route.ts:121-124` always sets it equal to `walletContractId`. It is a leftover from the classic-account era, but it is *load-bearing*: `resolveRecipient` reads `stellarAddress` while transfers use `walletContractId`. Don't drop it without changing both.

**The production guardrails live in one `.mjs` file, on purpose.** `next.config.mjs` (build time) and `src/lib/auth/config.ts` (runtime) both call `src/lib/config/production-guardrails.mjs`. It is plain ESM JavaScript rather than TypeScript because Next loads `next.config.mjs` through Node's ESM loader with no transpilation — don't convert it to `.ts`, and don't import `@stellar/stellar-sdk` from it. Add a new check there, not in either caller. (That was issue #57.)

**Rate limiting: four things not to break.** `src/lib/rate-limit.ts` guards the nine routes that reach `submitSignedTransaction`, `api/wallet/resolve` (issue #36), the three that email a one-time code and the three that take one back (issue #121). Don't move the counters out of the `rate_limits` table, don't switch the window clock from JS `Date.now()` to SQL `now()`, don't hoist `enforceFeePayerRateLimit` to the top of a handler or into middleware, and don't read `X-Forwarded-For` from the left. Why each: [ADR 0008](./docs/decisions/0008-fee-payer-rate-limiting.md). Every limited route has its own enforcement test — the wiring is per route, so deleting one call is otherwise invisible. `isRecoveryInitiationRateLimited` in `src/lib/auth/recovery.ts` is unrelated and stays.

**One-time codes are emailed and nowhere else.** Signup verification, PIN reset and recovery used to return the code in the response (issue #18); all three now only mail it, on every network, and there is deliberately no dev-only endpoint that reveals one. Read it from the `[MAIL:log]` line in the dev-server terminal, or from the user row in `db:studio` — `docs/testing.md` has the three places. Everything that makes that code a real secret is in issue #121 and easy to undo by accident: **one** generator (`generateVerificationCode`, `randomInt`, never `Math.random()`), a 15-minute expiry *enforced on verify*, a five-guess cap that **destroys the code** rather than setting a lockout timestamp (three guesses and an hour-long lockout for recovery), `constantTimeEquals` from `src/lib/constant-time.ts` rather than `===` (the admin token and the recovery code share it — do not write a second one, and note it takes `unknown` and answers `false` for a non-string so a JSON number cannot crash a handler), `enforceAuthCodeRateLimit` on the three that issue and `enforceAuthVerifyRateLimit` on the three that verify, both keyed on the **submitted** address plus the IP, because `api/auth/email-challenge`, `api/auth/verify-email` and the two recovery routes are unauthenticated.

**The attempt cap is enforced under a row lock, and that is not decoration.** `verifyOneTimeCode` and `verifyRecoveryCode` in `src/lib/auth/store.ts` run their whole read/compare/write inside one transaction behind `SELECT … FOR UPDATE`. They used to read the count through `getUserByEmail`, add one in JavaScript and write the sum back; twenty wrong guesses issued in parallel all read the same stale count, all wrote the same number, and the cap was never reached — sequentially the same twenty destroyed the code on the fifth, so every test passed. An atomic `coalesce(attempts, 0) + 1` is not enough on its own either, because the comparison happens in JavaScript (constant-time cannot be SQL `=`), so every guess that read the row before the cap landed was still evaluated against a live code. Don't call anything that touches `db` from inside those transactions — it takes a second pool client and waits on a lock the transaction holds — and don't `throw` from inside one after counting an attempt, or the rollback discards the count. `src/lib/auth/attempt-cap.test.ts` fires twenty parallel guesses at each of the three verifiers and asserts the sequential outcome exactly. A mail failure on those routes returns **502**, not 200 — the inverse of the claim-link rule below, because nothing irreversible has happened yet. `email-challenge` re-issues for an existing *unverified* row instead of 409; without that resend path, the expiry strands anyone whose mail never arrived. Reasoning in [`docs/production-readiness.md`](./docs/production-readiness.md).

**The session preamble lives in `src/lib/auth/route-guard.ts` — but most routes don't use it yet.** `requireSessionEmail` / `requireWalletUser` / `requireVerifiedUser` were extracted while wiring the rate limits, and **9** route files were migrated. **15 others still hand-roll the same cookie-verify-load block** — use the guards in new routes, and migrate one when you touch it. The 404 bodies differ per route on purpose (`Wallet not deployed` vs `Wallet not found` vs `User not found or email not verified`), so each caller passes its own — don't unify them, existing route tests assert the text. `api/wallet/recovery/submit` keeps its own preamble because it authenticates with `RECOVERY_COOKIE_NAME`, not a session.

**The escrow expiry unit changes across the boundary.** The contract takes `expiry` as a **ledger sequence**; `claim_links.expiry` in Postgres is a **timestamp**. The conversion is done ad hoc in `api/wallet/claim-links/create/route.ts`.

**Passkey registration needs a server challenge, and the client must ask for one first.** `createPasskeyKit()` with no argument cannot register a passkey — `api/wallet/deploy`, `api/wallet/backup-passkey` and `api/wallet/recovery/submit` reject a response whose challenge they did not issue. Call `fetchPasskeyChallenge()` and pass the result to `createPasskeyKit(challenge)`; it injects the nonce through passkey-kit's `WebAuthn` config point, because `createWallet`/`createKey` otherwise generate their own. Challenges are single-use and expire in five minutes. Registration uses `users.passkey_challenge`, deliberately separate from the `pending_challenge` column the login and Ed25519 flows share. (That was issue #56.)

**Dead code that still looks alive:**
- `POCKETLET_DATA_DIR` now holds only `fee_payer_secret`, not user data.

The `/swap` page, `api/wallet/swap`, and `submitSignedTransactionFast` were deleted in issue #106. Swaps are a V3 item — see [`docs/roadmap.md`](./docs/roadmap.md).

**Email notifications are real; SMS ones are not.** `src/lib/notifications.ts` delivers through the `Mailer` seam in `src/lib/mail/` — Resend when `RESEND_API_KEY` is set, otherwise `logMailer`, which prints to stdout and reports success so testnet works with no API key. A phone recipient gets a row with `status: 'unsupported'` and no delivery attempt; there is no SMS provider (issue #60). `Mailer.send` and `deliverClaimLinkNotification` **never throw** — every failure is a return value written to the row — because the caller has already put an escrow deposit on chain by the time either runs (issue #120), and a 500 there invites the user to deposit twice. Keep it that way, and keep delivery outside the `try` in `api/wallet/claim-links/create`. That route can still 500 after the deposit is on chain by a different path — the `claim_links` insert is after the submit and inside the `try` — which is open as issue #139, not something to fix incidentally.

**There is no claim URL and no claim page.** `apps/web/src/app/` has no `claim` route: `api/wallet/claim-links/pending` matches pending links where `recipient_email` or `recipient_phone` equals the logged-in user's. The "claim link" in `send/page.tsx` is a share *message*, not a URL, and the notification email tells the recipient to sign up with that exact address rather than to click anything. Don't write copy, or docs, that imply a link.

**The React lint rules come from the plugins, not `eslint-config-next`.** `packages/config/eslint/index.mjs` registers `eslint-plugin-react-hooks` and `@next/eslint-plugin-next` by hand. `eslint-config-next` is *not* installed and cannot be: its 15.x line pins `eslint: ^7 || ^8 || ^9` and this repo is on ESLint 10, while its 16.x line targets Next 16 (issue #90). Two consequences. `next-env.d.ts` has to be ignored explicitly in that file — Next writes triple-slash references into it and `@typescript-eslint/triple-slash-reference` rejects them, and `eslint-config-next` would otherwise have ignored it for us. And `react-hooks/set-state-in-effect` is switched off there: it flags 12 pre-existing effects that each need their own behaviour-preserving restructure, and there are no component tests behind them yet (issue #63) — tracked in issue #131. It is the only rule of the react-hooks v7 preset that is off; the other 15, including the React Compiler rules, are all at `error` (the preset ships `exhaustive-deps`, `incompatible-library` and `unsupported-syntax` at `warn`, and the config raises all three).

**TypeScript is pinned at 6, and 7 is blocked outside this repo.** `typescript-eslint` 8.70.0 declares `typescript: >=4.8.4 <6.1.0`, so 6.1 and 7 are both out of range (issue #107, still open). **That is silent by default** — typescript-eslint's default is `'warn'`, a `console.log` guarded by `process.stdout.isTTY`, so CI prints nothing and exits 0, and pnpm does not enforce peer ranges either. `packages/config/eslint/index.mjs` therefore sets `onUnsupportedTypeScriptVersion: 'error'` so the parser throws; verified by faking `ts.version` to 6.1.0, where lint exits 0 without the option and 1 with it. Keep it, and note the specifier is `^6.0.3`, which permits 6.1 on its own.

Three more things the 6.0 upgrade left behind that look droppable and are not. `apps/web/tsconfig.json` no longer sets `baseUrl` — deprecated in 6 (TS5101), stops working in 7; `paths` resolves relative to the tsconfig that declares it, so re-adding `baseUrl` only re-breaks the build. `apps/web/src/types/css.d.ts` declares `*.css` as an export-less module, because 6 reports TS2882 for a side-effect import it cannot resolve and Next declares CSS *modules* but not plain stylesheets; `import './globals.css'` in `src/app/layout.tsx` is the only such import. That file also re-declares `*.module.css` even though Next already does: TypeScript picks between wildcard ambient modules on prefix length alone, and both share the empty prefix, so whichever is bound first wins — matching Next's shape makes the order stop mattering.

**`next build` rewrites a tracked file, after lint has already run.** It regenerates `apps/web/next-env.d.ts`. CI's order is lint → typecheck → test → build, so a lint error introduced by the build only shows up on the *next* run. If you change the Next version, run `pnpm run lint` again after `pnpm --filter web build`. Separately, `tsc` caches to `apps/web/tsconfig.tsbuildinfo` (gitignored) and `.next/types` is generated: after switching branches, a typecheck error naming a route that doesn't exist on your branch means a stale artifact, not a real failure — `rm -rf apps/web/.next apps/web/tsconfig.tsbuildinfo`.

**Wallet-admin writes are signed with `signAdmin`, and the compiler cannot tell you otherwise.** Since passkey-kit 0.19, `kit.sign()` refuses an auth entry that re-enters the connected wallet — which is exactly what `add_signer`, `remove_signer` and `upgrade` do. The declared-intent path is `kit.signAdmin()`, and **the two have identical signatures**, so writing `sign` where `signAdmin` belongs typechecks, lints, and fails only at signing time against a real wallet. Nothing in CI reaches that. Anything built by `addSecp256r1` / `addEd25519` / `addPolicy` / `update*` / `remove` / `upgrade` takes `signAdmin`; a SAC token transfer takes `sign`. The seven call sites are pinned by a source scan in `src/lib/wallet/passkey-kit.test.ts` — if you add an admin builder, that scan is the only thing that will catch a miss.

**A wallet is not usable until its birth is recorded, and the record is per browser.** passkey-kit 0.19 leaves the kit disconnected after `createWallet`; `signup/page.tsx` calls `kit.confirmWalletCreation(result, hash)` with the hash `api/wallet/deploy` returns, which verifies the deployment on chain and writes the birth record (contract id, birth WASM hash, creation tx and ledger) into the browser's IndexedDB. That call has to stay client-side — the server cannot write to IndexedDB. The consequence is the open part: `connectWallet({ keyId })` no longer *derives* an address, it resolves candidates from that local record or from a `getWalletCandidates` indexer response, so login works on the signup device and fails with `WALLET_NOT_FOUND` on a fresh browser profile. The three ways out are written up in the big comment in `src/lib/wallet/passkey-kit.ts`; picking one is a product decision, not a cleanup.

**`NEXT_PUBLIC_WALLET_WASM_HASH` is not a value to edit from memory.** 0.19's constructor throws on the known-vulnerable legacy builds, and `connectWallet` refuses any wallet whose code is not in `acceptedWasmHashes` (which defaults to this one). Both fail against the network, never in CI. The current value is upstream's canonical build, published in passkey-kit's own `README.md`/`SECURITY.md` and in its `docs/deployments-2026-09-01.md` manifest. Take a replacement from a new manifest entry and nowhere else. `src/lib/wallet/passkey-kit.test.ts` pins the value and checks it against the kit's own blocklists.

**There is a pnpm override on `@simplewebauthn/browser`, and it is load-bearing.** `pnpm-workspace.yaml` forces the whole tree to v14. `passkey-kit` 0.19.1 still depends on `@simplewebauthn/browser@^13.3.0` as a *regular* dependency, not a peer, so without the override the tree carries two copies that disagree about `RegistrationResponseJSON.response.transports` (`string[]` in 14, a narrow union in 13) — which breaks the `WebAuthn` seam `createPasskeyKit` uses to inject the server challenge, because the kit types that seam against its own copy. The 0.19 migration did **not** retire it. Drop the override only when passkey-kit itself depends on 14 (issue #118 stays open for that).

**Not actually server components.** Despite App Router, essentially everything interactive is `'use client'`.

## Testing expectations

Colocate `*.test.ts` next to the source. Coverage is uneven — the gaps and their tracking issues are in [`docs/production-readiness.md`](./docs/production-readiness.md). Prefer closing those over deepening areas already covered. Rust panics in `contracts/escrow` carry `#[should_panic(expected = "...")]`, so a test fails on the wrong panic rather than passing on an unrelated setup failure; keep the string when you add or change one (#123 tracks converting the asserts to typed errors). See [`docs/testing.md`](./docs/testing.md).

## Keeping docs true

Each fact has one home; other docs link to it. When you change something, the
["if you change X, update Y" table in `CONTRIBUTING.md`](./CONTRIBUTING.md#if-you-change-x-update-y)
says what to update. It is the only copy — don't start another.
