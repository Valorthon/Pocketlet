# 0004. Railway + Docker for hosting

Status: Accepted
Date: 2026-08-25 (recorded retrospectively 2026-09-17)

## Context

V1 needed a public URL: passkeys require a stable origin, and a demo needed somewhere to live. Requirements were modest — a Next.js app, a Postgres database, low cost, minimal operational overhead.

An early attempt to deploy with Railway's default Railpack builder mis-detected the pnpm monorepo.

## Decision

Deploy to [Railway](https://railway.app/) from an explicit multi-stage `Dockerfile`, with `railway.json` pinning the Docker builder and the start command. Postgres runs as a Railway service supplying `DATABASE_URL`. The Next.js build uses `output: 'standalone'`.

## Consequences

One platform hosts both the app and its database, with `DATABASE_URL` wired automatically. The Dockerfile makes the build reproducible locally and removes any dependency on buildpack heuristics.

Railway's GitHub integration auto-deploys, so the `deploy-web` CI job is a safety net rather than the mechanism — it verifies the deployment config exists and exits cleanly when `RAILWAY_TOKEN` is unset.

Two wrinkles this introduced: `pg` and `drizzle-orm` must be externalized in `next.config.mjs` (both via `serverComponentsExternalPackages` and a manual webpack `externals` regex) for the standalone build to compile, and `apps/web/drizzle/` must be copied into the image so migrations are available at boot.

Rollback is a Railway dashboard action. It does **not** roll back migrations — see [operations.md](../operations.md#rolling-back).

## Alternatives considered

**Vercel** — the natural Next.js host, but Postgres would be a separate vendor and the standalone Docker build gives more control over a pnpm monorepo.

**Railpack (Railway's default builder)** — tried first; mis-detected the monorepo, hence `railway.json` forcing Docker.
