# 0005. Apply database migrations at application startup

Status: Accepted
Date: 2026-08-26 (recorded retrospectively 2026-09-17)

## Context

After moving to Postgres ([0002](./0002-postgres-over-file-storage.md)), the first Railway deploy failed: the schema did not exist and nothing in the pipeline created it. Railway's GitHub integration builds and starts a container; it offers no natural pre-start hook, and CD is a safety net rather than the deploy mechanism ([0004](./0004-railway-docker-deployment.md)), so a migration step in the workflow would not run on every deploy.

## Decision

Run migrations from the application itself. `apps/web/src/instrumentation.ts` uses Next.js's `instrumentationHook` to call Drizzle's `migrate()` against `apps/web/drizzle/` on startup, guarded by `NEXT_RUNTIME` so it only runs on the Node runtime. `apps/web/drizzle/` is copied into the Docker image.

## Consequences

Deploys are self-contained: whatever starts the container gets a correctly migrated schema, in production and in local development alike. No separate migration step, no drift between what shipped and what ran.

The trade-offs are real and worth knowing:

- **Rollback is asymmetric.** Migrations only ever move forward. Rolling back the app does not roll back the schema, so a destructive migration requires a database restore rather than a redeploy. This is the sharpest edge.
- **Startup can fail on a migration error**, taking the deploy with it. That is arguably correct — better than serving traffic against a half-migrated schema — but it means a bad migration is an outage, not a warning.
- **Concurrent instances could race** at boot. Drizzle's migrator takes a lock, so this is safe today, but it is a constraint to remember before scaling horizontally.

The same mechanism is why the test suite needs a live Postgres: `vitest.setup.ts` migrates at module load for the same reason.

## Alternatives considered

**A migration step in CD** — cleaner separation, but would not run on Railway's own auto-deploys, which are the actual deploy path.

**Manual migrations** — unacceptable; guarantees someone eventually forgets.

**A release-phase command** — what a platform like Heroku offers. Railway has no direct equivalent.
