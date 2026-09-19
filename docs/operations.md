# Operations

Last reviewed: 2026-09-17

How Pocketlet gets deployed, and what to do when it misbehaves. Branch semantics are in [`CONTRIBUTING.md`](../CONTRIBUTING.md#branch-model).

## What runs where

Everything below runs against **Stellar Testnet**. Mainnet is not supported.

There are two independent web deployments, one per release branch:

| Piece | Where | How |
| --- | --- | --- |
| Web app (internal) | Railway — internal service, watches `stag-test` | Docker image from `Dockerfile`, started per `railway.json` as `node apps/web/server.js` |
| Web app (public) | Railway — public service, watches `prod-test` | Same image and start command, different service and domain |
| Database | Railway Postgres — **one per service** | `DATABASE_URL` injected by Railway |
| Escrow contract | Stellar Testnet | Deployed by CI from the `stag-test` branch, or manually |

The two services share nothing. Each has its own Postgres, its own domain, and its own runtime secrets. That separation is the point — a bad release reaches the team before it reaches the public — but it has a consequence worth stating plainly: **passkeys are bound to `WEBAUTHN_RP_ID`, so an account registered on the internal domain does not exist on the public one.** There is no migration path between them; a tester needs an account on each.

The web build is a Next.js **standalone** output. `apps/web/drizzle/` is copied into the image, and `src/instrumentation.ts` applies pending migrations at boot — there is no separate migration step in the deploy pipeline.

## Pipelines

### CI — `.github/workflows/ci.yml`

Runs on pushes and PRs to `develop`, `stag-test`, and `prod-test`. Two jobs:

- **contracts** — Rust stable with `wasm32v1-none`, Stellar CLI 28, then `cargo test`, `stellar contract build`, and a check that `target/wasm32v1-none/release/pocketlet_escrow.wasm` exists.
- **web** — pnpm + Node 22, a Postgres 16 service container, `cp .env.example .env.local`, then lint → typecheck → test → build.

The Postgres service is not optional: the Vitest setup migrates and clears a real database.

### CD — `.github/workflows/cd.yml`

Path-filtered via `dorny/paths-filter`, so unrelated changes don't trigger deploys.

- **deploy-contract** — on `stag-test` only, when `contracts/**` changed. Builds, deploys to testnet, and prints the address in the workflow summary. Uses `secrets.STELLAR_DEPLOYER_SECRET` for a stable address; without it, generates and Friendbot-funds a throwaway key, giving a *new address every run*. Uploads the WASM as an artifact. `prod-test` never deploys a contract — it points at whatever address its Railway environment already holds.
- **deploy-web** — on both `stag-test` and `prod-test`, when web files changed. The job picks its target through a GitHub Environment:

  ```yaml
  environment: ${{ github.ref == 'refs/heads/prod-test' && 'prod-test' || 'stag-test' }}
  ```

  so `RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`, and `RAILWAY_SERVICE_NAME` resolve per environment and the step bodies stay identical. It verifies `railway.json` and `Dockerfile` exist, then runs `railway up` **only if `RAILWAY_TOKEN` is set**; otherwise it logs and exits 0, because Railway's own GitHub integration already auto-deploys.

After a contract deploy, set `NEXT_PUBLIC_ESCROW_CONTRACT_ID` to the new address in the Railway environment. It is not propagated automatically — and with two services, that is now **two** places to update. Deploying a contract from `stag-test` does not change what `prod-test` is pointing at until you say so, which is deliberate.

### Secrets and variables

`STELLAR_DEPLOYER_SECRET` is repository-wide; only `stag-test` deploys contracts. The Railway values live on the **GitHub Environments** `stag-test` and `prod-test`, one set each, so the same workflow step reaches a different service depending on the branch.

| Name | Kind | Scope | Needed for |
| --- | --- | --- | --- |
| `STELLAR_DEPLOYER_SECRET` | secret | repository | A stable escrow address across deploys |
| `RAILWAY_TOKEN` | secret | per environment | Optional — only to push deploys from Actions rather than Railway's integration |
| `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_NAME` | variables | per environment | Optional, target a specific Railway service |

Add a required reviewer on the `prod-test` environment if public deploys should be gated — that is a GitHub setting, not something this repo can encode.

Runtime secrets (`SESSION_SECRET`, `FEE_PAYER_SECRET_KEY`, `CLAIM_SECRET_ENCRYPTION_KEY`, `ADMIN_SECRET_TOKEN`) are set in the Railway environment, not in GitHub, and each service needs its own distinct set — never share a `SESSION_SECRET` or `FEE_PAYER_SECRET_KEY` between internal and public. Generate each with `openssl rand -hex 32`, and store them in a secrets manager rather than an env file. Rotating `FEE_PAYER_SECRET_KEY` needs no user action — drain and retire the old account; rotating `SESSION_SECRET` signs everyone out and invalidates outstanding recovery tokens. Every variable is described in `apps/web/.env.example`.

## Deploying manually

```bash
pnpm run deploy:contract     # build + deploy escrow to testnet
pnpm run deploy:web          # railway up (needs @railway/cli)
```

`contracts/deploy.sh` honours `STELLAR_NETWORK` and `STELLAR_DEPLOYER_KEY_NAME`.

> The deploy steps exist twice — in `contracts/deploy.sh` and inlined in `cd.yml`. They can drift. Change both.

## Rolling back

**Web:** redeploy the previous image from the Railway dashboard, on the affected service. Reverting the commit on `prod-test` also works but is slower. Rolling back one service does not touch the other — if the bad release also sits on `stag-test`, revert it there too, or the next promotion reintroduces it. Bear in mind that a rollback **does not roll back migrations** — `instrumentation.ts` only applies them forward. If a release included a destructive migration, restore the database from a Railway backup rather than rolling back the app alone.

**Contract:** contracts are immutable and the escrow contract has no upgrade path. "Rolling back" means deploying the previous source and pointing `NEXT_PUBLIC_ESCROW_CONTRACT_ID` at the new address. **Funds already escrowed under the old contract stay there** — they remain claimable and refundable at the old address, so keep it recorded.

## Monitoring

`/admin` shows counters from the `metrics` table (`api/admin/stats`), gated by a bearer token.

> While `ADMIN_SECRET_TOKEN` is unset or still the `.env.example` default, admin auth fails closed: `api/admin/stats` returns **503** with "Admin API is not configured", which `/admin` shows on the login card, and logs the same to the server. A wrong token returns an undifferentiated **401**.

`src/lib/metrics.ts` increments counters with `incrementMetric()`. There is no external monitoring, alerting, or log aggregation; the app writes ~23 raw `console.*` calls with no logging abstraction. Railway's log view is the only observability today.

## Common production problems

**App won't start.** The guardrails fail fast by design. On the public network, startup aborts if `SESSION_SECRET` is default/short, `WEBAUTHN_ORIGIN` isn't HTTPS, `WEBAUTHN_RP_ID` is `localhost`, or `FEE_PAYER_SECRET_KEY` is missing. The error names the variable. Note that the build-time checks in `next.config.mjs` and the runtime checks in `src/lib/auth/config.ts` cover slightly different sets (issue #57).

**Transactions fail to submit.** The fee payer is probably out of XLM. On testnet it refunds via Friendbot; on the public network it needs topping up. User funds are never at risk — [why](../docs/architecture.md#why-there-is-a-fee-payer).

**Claim links throw.** `CLAIM_SECRET_ENCRYPTION_KEY` or `NEXT_PUBLIC_ESCROW_CONTRACT_ID` is unset in the environment.

**Passkeys stop working after a domain change.** They're bound to `WEBAUTHN_RP_ID`. Changing the domain invalidates existing credentials; users must recover with their phrase or backup passkey.
