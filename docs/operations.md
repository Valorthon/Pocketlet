# Operations

Last reviewed: 2026-09-17

How Pocketlet gets deployed, and what to do when it misbehaves. Branch semantics are in [`CONTRIBUTING.md`](../CONTRIBUTING.md#branch-model).

## What runs where

| Piece | Where | How |
| --- | --- | --- |
| Web app | Railway | Docker image from `Dockerfile`, started per `railway.json` as `node apps/web/server.js` |
| Database | Railway Postgres | `DATABASE_URL` injected by Railway |
| Escrow contract | Stellar Testnet | Deployed by CI from the `staging` branch, or manually |

The web build is a Next.js **standalone** output. `apps/web/drizzle/` is copied into the image, and `src/instrumentation.ts` applies pending migrations at boot — there is no separate migration step in the deploy pipeline.

## Pipelines

### CI — `.github/workflows/ci.yml`

Runs on pushes and PRs to `develop`, `staging`, and `main`. Two jobs:

- **contracts** — Rust stable with `wasm32v1-none`, Stellar CLI 27, then `cargo test`, `stellar contract build`, and a check that `target/wasm32v1-none/release/pocketlet_escrow.wasm` exists.
- **web** — pnpm + Node 22, a Postgres 16 service container, `cp .env.example .env.local`, then lint → typecheck → test → build.

The Postgres service is not optional: the Vitest setup migrates and truncates a real database.

### CD — `.github/workflows/cd.yml`

Path-filtered via `dorny/paths-filter`, so unrelated changes don't trigger deploys.

- **deploy-contract** — on `staging`, when `contracts/**` changed. Builds, deploys to testnet, and prints the address in the workflow summary. Uses `secrets.STELLAR_DEPLOYER_SECRET` for a stable address; without it, generates and Friendbot-funds a throwaway key, giving a *new address every run*. Uploads the WASM as an artifact.
- **deploy-web** — on `main`, when web files changed. Verifies `railway.json` and `Dockerfile` exist, then runs `railway up` **only if `RAILWAY_TOKEN` is set**; otherwise it logs and exits 0, because Railway's own GitHub integration already auto-deploys.

After a contract deploy, set `NEXT_PUBLIC_ESCROW_CONTRACT_ID` to the new address in the Railway environment. It is not propagated automatically.

### Secrets and variables

| Name | Kind | Needed for |
| --- | --- | --- |
| `STELLAR_DEPLOYER_SECRET` | secret | A stable escrow address across deploys |
| `RAILWAY_TOKEN` | secret | Optional — only to push deploys from Actions rather than Railway's integration |
| `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_NAME` | variables | Optional, target a specific Railway service |

Runtime secrets (`SESSION_SECRET`, `FEE_PAYER_SECRET_KEY`, `CLAIM_SECRET_ENCRYPTION_KEY`, `ADMIN_SECRET_TOKEN`) are set in the Railway environment, not in GitHub. See [environment.md](./environment.md).

## Deploying manually

```bash
pnpm run deploy:contract     # build + deploy escrow to testnet
pnpm run deploy:web          # railway up (needs @railway/cli)
```

`contracts/deploy.sh` honours `STELLAR_NETWORK` and `STELLAR_DEPLOYER_KEY_NAME`.

> The deploy steps exist twice — in `contracts/deploy.sh` and inlined in `cd.yml`. They can drift. Change both.

## Rolling back

**Web:** redeploy the previous image from the Railway dashboard. Reverting the commit on `main` also works but is slower. Bear in mind that a rollback **does not roll back migrations** — `instrumentation.ts` only applies them forward. If a release included a destructive migration, restore the database from a Railway backup rather than rolling back the app alone.

**Contract:** contracts are immutable and the escrow contract has no upgrade path. "Rolling back" means deploying the previous source and pointing `NEXT_PUBLIC_ESCROW_CONTRACT_ID` at the new address. **Funds already escrowed under the old contract stay there** — they remain claimable and refundable at the old address, so keep it recorded.

## Monitoring

`/admin` shows counters from the `metrics` table (`api/admin/stats`), gated by a bearer token.

> While `ADMIN_SECRET_TOKEN` is still the `.env.example` default, admin auth **fails closed and silently** — `/admin` gives no indication why. If the dashboard appears broken, check that variable first.

`src/lib/metrics.ts` increments counters with `incrementMetric()`. There is no external monitoring, alerting, or log aggregation; the app writes ~23 raw `console.*` calls with no logging abstraction. Railway's log view is the only observability today.

## Common production problems

**App won't start.** The guardrails fail fast by design. On the public network, startup aborts if `SESSION_SECRET` is default/short, `WEBAUTHN_ORIGIN` isn't HTTPS, `WEBAUTHN_RP_ID` is `localhost`, or `FEE_PAYER_SECRET_KEY` is missing. The error names the variable. Note that build-time and runtime checks cover slightly different sets — see [environment.md](./environment.md#public-network-guardrails).

**Transactions fail to submit.** The fee payer is probably out of XLM. On testnet it refunds via Friendbot; on the public network it needs topping up. It is not a signer on user wallets, so this never puts funds at risk.

**Claim links throw.** `CLAIM_SECRET_ENCRYPTION_KEY` or `NEXT_PUBLIC_ESCROW_CONTRACT_ID` is unset in the environment.

**Passkeys stop working after a domain change.** They're bound to `WEBAUTHN_RP_ID`. Changing the domain invalidates existing credentials; users must recover with their phrase or backup passkey.
