# Architecture Decision Records

Last reviewed: 2026-09-17

Short records of decisions that are expensive to reverse or non-obvious in hindsight. Write one when a choice would otherwise leave a future reader asking "why on earth is it like this?"

ADRs are immutable once merged. If a decision changes, add a new ADR and mark the old one superseded.

| # | Decision | Status |
| --- | --- | --- |
| [0001](./0001-passkey-kit-smart-accounts.md) | Passkey-kit smart accounts over a custom smart wallet | Accepted |
| [0002](./0002-postgres-over-file-storage.md) | PostgreSQL + Drizzle over JSON file storage | Accepted |
| [0003](./0003-fee-payer-resubmission.md) | Server-held fee payer rebuilds and resubmits, rather than OpenZeppelin Channels | Accepted |
| [0004](./0004-railway-docker-deployment.md) | Railway + Docker for hosting | Accepted |
| [0005](./0005-migrate-on-boot.md) | Apply database migrations at application startup | Accepted |
| [0006](./0006-escrow-claim-link-design.md) | Hash-based escrow for claimable links | Accepted |
| [0007](./0007-testnet-branch-model.md) | Two testnet release branches, no `main` | Accepted |

0001–0006 were written retrospectively on 2026-09-17, reconstructed from the code and git history. They record *what* was decided and what follows from it; where the original reasoning is uncertain, they say so.

## Template

```markdown
# NNNN. Title

Status: Proposed | Accepted | Superseded by [NNNN](./NNNN-....md)
Date: YYYY-MM-DD

## Context
What forced a decision. Constraints, and what was true at the time.

## Decision
What was chosen, stated plainly.

## Consequences
What this makes easy, what it makes hard, and what it rules out.

## Alternatives considered
What else was on the table, and why it lost.
```
