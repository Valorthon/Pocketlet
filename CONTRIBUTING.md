# Contributing

Last reviewed: 2026-09-17

Setup lives in the [README quickstart](./README.md#quickstart). Stack, conventions, and known traps live in [`AGENTS.md`](./AGENTS.md). This file covers how work moves through the repo.

## Remotes

`origin` → `Valorthon/Pocketlet` is **canonical**. Open PRs and issues there.

`public` → `SaltinStillWaters/Pocketlet` is a secondary mirror. Don't treat it as the source of truth.

## Branch model

| Branch | Role | What happens on push |
| --- | --- | --- |
| `develop` | Default branch. All feature work merges here. | CI (lint, typecheck, test, build, contract build) |
| `staging` | Contract release branch. | CI + deploys the escrow contract to testnet |
| `main` | Web release branch. | CI + triggers the Railway web deploy job |
| `production` | What Railway actually serves. | Railway auto-deploy |

Flow: `feat/…` or `fix/…` → PR into `develop` → promote to `staging` (contracts) or `main` (web) → `production`.

> **History note.** Between 2026-08-06 and 2026-09-17, CI triggered only on `main` and `staging`, while every PR merged into `develop`. About 15 PRs landed with no CI at all and `main` fell 67 commits behind. The triggers now include `develop`. If you change a workflow trigger, update this table in the same PR — the mismatch between the documented model and the actual triggers is exactly what let this go unnoticed.

## Branch and commit naming

Branches: `feat/<short-description>`, `fix/<short-description>`, `refactor/…`, `docs/…`, `ci/…`, `chore/…`.

Commits follow Conventional Commits — `type(scope): summary`:

```
feat(escrow): add claimable links for unregistered recipients
fix(web): guard send amount against balance
docs(readme): correct the contract build output path
ci(contracts): run cargo test on develop
```

Types in use: `feat`, `fix`, `refactor`, `perf`, `docs`, `ci`, `chore`. Scopes in use: `web`, `escrow`, `contracts`, `auth`, `onboarding`, `ui`, `deploy`, `readme`.

Reference issues in the body or summary — `fixes #52`, `closes #23`.

## Definition of done

Before requesting review:

- [ ] `pnpm run lint` passes (`--max-warnings=0`)
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm --filter web test` passes (Postgres running)
- [ ] `cargo test` passes, if `contracts/` changed
- [ ] CI is green on the PR
- [ ] Docs updated, or explicitly N/A

No `any`, no `@ts-ignore`, no new `eslint-disable` without a comment explaining why.

## If you change X, update Y

Docs here rotted for a month because the same fact lived in four files. Each fact now has exactly one home.

| You changed | Update |
| --- | --- |
| An environment variable | [`docs/environment.md`](./docs/environment.md) **and** `apps/web/.env.example` |
| `apps/web/src/lib/db/schema.ts` | [`docs/database.md`](./docs/database.md), and run `pnpm --filter web db:generate` |
| The escrow contract interface | [`contracts/escrow/README.md`](./contracts/escrow/README.md) |
| Whether a feature works | the [README feature table](./README.md#features) — and nowhere else |
| A branch rule or workflow trigger | this file |
| Something with a non-obvious rationale | a new ADR in [`docs/decisions/`](./docs/decisions/README.md) |
| A testnet shortcut, or closing one | [`docs/production-readiness.md`](./docs/production-readiness.md) |

Every doc under `docs/` carries a `Last reviewed:` date. Bump it when you verify or revise the content — not for a typo fix. A date more than a couple of months stale is a prompt to re-check, not proof the doc is wrong.

## Reporting security issues

See [`SECURITY.md`](./SECURITY.md). Don't open a public issue for a vulnerability.
