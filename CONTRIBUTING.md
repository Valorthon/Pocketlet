# Contributing

Last reviewed: 2026-09-17

Setup lives in the [README quickstart](./README.md#quickstart). Stack, conventions, and known traps live in [`AGENTS.md`](./AGENTS.md). This file covers how work moves through the repo.

## Remotes

`origin` → `Valorthon/Pocketlet` is the only remote. Open PRs and issues there.

A second remote, `public` → `SaltinStillWaters/Pocketlet`, was retired on 2026-09-17. It deployed nothing and had drifted behind. If you still have it locally, drop it: `git remote remove public`.

## Branch model

Pocketlet runs on **Stellar Testnet only — mainnet is not supported**, so there is deliberately no `main` branch. Both deploy branches point at testnet; they differ in audience and in which Railway service they feed.

| Branch | Role | What happens on push |
| --- | --- | --- |
| `develop` | Default branch. All feature work merges here. | CI (lint, typecheck, test, build, contract build) |
| `stag-test` | Internal testnet release — the team's shakeout target. | CI + Railway deploy to the internal service + deploys the escrow contract to testnet |
| `prod-test` | Public testnet release — what outside users see. | CI + Railway deploy to the public service |

Flow: `feat/…` or `fix/…` → PR into `develop` → promote to `stag-test` → promote to `prod-test`.

The two deploys are fully separate environments — separate Railway services, separate databases, separate domains. Passkeys are bound to a domain, so an account registered on `stag-test` does not exist on `prod-test`. Details in [`docs/operations.md`](./docs/operations.md).

Adding mainnet support later means a new branch and a new ADR, not renaming these.

> **History note.** Between 2026-08-06 and 2026-09-17, CI triggered only on `main` and `staging`, while every PR merged into `develop`. About 15 PRs landed with no CI at all and `main` fell 67 commits behind. The triggers now include `develop`. If you change a workflow trigger, update this table in the same PR — the mismatch between the documented model and the actual triggers is exactly what let this go unnoticed.
>
> **Rename, 2026-09-17.** `staging` → `stag-test`, `main` → `prod-test`, `production` deleted. Older PRs, CI runs, and commit messages still use the old names — [ADR 0007](./docs/decisions/0007-testnet-branch-model.md) explains the change.

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
| An environment variable | [`apps/web/.env.example`](./apps/web/.env.example) — the only home; `src/lib/env-parity.test.ts` fails if you forget |
| `apps/web/src/lib/db/schema.ts` | The comments in that file, and run `pnpm --filter web db:generate` |
| The escrow contract interface | [`contracts/escrow/README.md`](./contracts/escrow/README.md) |
| Whether a feature works | the [README feature table](./README.md#features) — and nowhere else |
| Which version a feature belongs to | [`docs/roadmap.md`](./docs/roadmap.md) — versions only; it never states status |
| A branch rule or workflow trigger | this file |
| A Railway service, environment, or deploy target | [`docs/operations.md`](./docs/operations.md) |
| Something with a non-obvious rationale | a new ADR in [`docs/decisions/`](./docs/decisions/README.md) |
| A testnet shortcut, or closing one | [`docs/production-readiness.md`](./docs/production-readiness.md) |

Every doc under `docs/` carries a `Last reviewed:` date. Bump it when you verify or revise the content — not for a typo fix. A date more than a couple of months stale is a prompt to re-check, not proof the doc is wrong.

## Reporting security issues

See [`SECURITY.md`](./SECURITY.md). Don't open a public issue for a vulnerability.
