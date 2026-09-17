# 0007. Two testnet release branches, no `main`

Status: Accepted
Date: 2026-09-17

## Context

Until now the repository carried four long-lived branches: `develop` (default, where all
feature work merged), `staging` (contract releases), `main` (web releases), and `production`
(what Railway actually served).

Three things were wrong with that.

**The names described a product we don't have.** `main` and `production` read as a
testnet→mainnet promotion ladder. Pocketlet is testnet-only; mainnet is deferred and
unscheduled. Anyone new to the repo reasonably assumed `production` meant real money, and
the docs had to keep explaining that it didn't.

**The shape didn't match the actual need.** Splitting releases by *artifact* — contracts on
one branch, web on another — meant there was no way to put a web build in front of the team
before it reached the public. The real requirement is two deploy targets distinguished by
*audience*, not by what's being deployed.

**`production` was invisible to the repository.** It appeared in exactly one line of prose in
`CONTRIBUTING.md` and nowhere in any workflow; the branch→environment binding lived only in
the Railway dashboard. Nothing in-repo could have caught it drifting.

Separately, a second remote `public` → `SaltinStillWaters/Pocketlet` was documented as a
mirror of the canonical `Valorthon/Pocketlet`. It deployed nothing, had no `staging` or
`production`, and had already fallen behind. A documented mirror nobody pushes to is an
invitation to diverge.

Context for the timing: a `Last reviewed: 2026-09-17` audit found CI had triggered only on
`main` and `staging` while every PR merged to `develop`, so roughly 15 PRs landed with no CI
and `main` fell 67 commits behind. The branch model was already being repaired; this decision
finishes the job rather than leaving the names half-right.

## Decision

Three long-lived branches, named so that neither deploy branch reads as mainnet:

| Branch | Role | Deploys |
| --- | --- | --- |
| `develop` | Default. All feature work merges here. | nothing |
| `stag-test` | Internal testnet release. | Railway internal service, plus the escrow contract |
| `prod-test` | Public testnet release. | Railway public service |

Promotion runs `develop` → `stag-test` → `prod-test`. Both deploy branches target Stellar
Testnet. There is no `main`.

`staging` was renamed to `stag-test` and `main` to `prod-test`, preserving their refs;
`production` was deleted once Railway was repointed. `origin` → `Valorthon/Pocketlet` is now
the only remote.

Contracts deploy from `stag-test` only. `prod-test` uses whatever
`NEXT_PUBLIC_ESCROW_CONTRACT_ID` its own Railway environment holds, so promoting a web
release never silently repoints the public deployment at a new contract.

CD selects its Railway target with a GitHub Environment keyed off the ref
(`github.ref == 'refs/heads/prod-test' && 'prod-test' || 'stag-test'`) rather than a second
copy of the deploy job, because the deploy steps are already duplicated between
`contracts/deploy.sh` and `cd.yml` and a third copy would be a third thing to drift.

## Consequences

Two Railway services now need maintaining, each with its own Postgres, its own domain, and
its own runtime secrets. That is the cost of the isolation, and it is the point.

The consequence most likely to surprise someone: **passkeys are bound to `WEBAUTHN_RP_ID`**,
so an account registered against the internal domain does not exist on the public one. There
is no migration between the two. Testers need an account on each, and a bug reproduced with a
specific account on one deploy cannot be reproduced with that account on the other.

`NEXT_PUBLIC_ESCROW_CONTRACT_ID` is now set by hand in two places instead of one.

Old PRs, CI runs, and commit messages still name `main`, `staging`, and `production`. The
history note in `CONTRIBUTING.md` records the mapping so those remain readable.

Adding mainnet later means adding a branch and writing a new ADR — not renaming these. That
is deliberate: renaming `prod-test` to mean "real money" is exactly the ambiguity this
decision removes.

Losing the `public` mirror means a single point of failure for hosting. Given that it was
stale and deployed nothing, it was providing the appearance of redundancy rather than the
substance of it.

## Alternatives considered

**Keep `main` as a frozen trunk for a future mainnet cutover.** Rejected. An unused branch
still has to be configured around — CI triggers, branch protection, dependabot targets — and
an empty branch named `main` is precisely the signal that misleads newcomers today. The
future cutover is cheap to set up when it's real.

**One testnet deploy, with a feature flag gating internal users.** Rejected. It doesn't
isolate a bad release: a broken build or a bad migration reaches everyone regardless of what
the flag says. Flags gate features, not deploys.

**Rename only, keeping the artifact split (`stag-test` for contracts, `prod-test` for web).**
Rejected for the reason above — it preserves the mismatch between the branch model and the
actual need while making the names imply otherwise.

**Two copies of the `deploy-web` job instead of a GitHub Environment.** Rejected as a drift
hazard; see the note under Decision.
