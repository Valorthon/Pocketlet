# Pocketlet documentation

Last reviewed: 2026-09-17

## Where do I look for…

| I want to… | Read |
| --- | --- |
| Run the app locally | [README quickstart](../README.md#quickstart) |
| Know what actually works | [README feature table](../README.md#features) |
| Write code here, or brief an agent | [`AGENTS.md`](../AGENTS.md) |
| Open a PR, or understand the branches | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Report a vulnerability | [`SECURITY.md`](../SECURITY.md) |
| Understand how the pieces fit together | [architecture.md](./architecture.md) |
| Look up an environment variable | [environment.md](./environment.md) |
| Work with the database | [database.md](./database.md) |
| Run tests, or test a flow end to end | [testing.md](./testing.md) |
| Deploy, roll back, or debug prod | [operations.md](./operations.md) |
| Understand what the product is for | [product-spec.md](./product-spec.md) |
| See what's planned | [roadmap.md](./roadmap.md) |
| Know what blocks mainnet | [production-readiness.md](./production-readiness.md) |
| Know why something was built this way | [decisions/](./decisions/README.md) |
| Work on the smart contract | [`contracts/escrow/README.md`](../contracts/escrow/README.md) |

Speculative, unscheduled thinking lives in [ideas.md](./ideas.md). Market positioning lives in [research/competitive-analysis.md](./research/competitive-analysis.md). Neither is a commitment.

## How these docs are maintained

Every doc carries a `Last reviewed:` date. Bump it when you verify or revise the content.

Each fact has exactly one home, and other docs link to it rather than restating it. Before writing a sentence, check whether it belongs somewhere else:

- **Feature status** → the README table, nowhere else.
- **Fee-payer mechanics and the custody model** → [architecture.md](./architecture.md).
- **Environment variables** → [environment.md](./environment.md) and `apps/web/.env.example`.
- **Schema** → [database.md](./database.md).
- **Contract interface** → [`contracts/escrow/README.md`](../contracts/escrow/README.md).
- **Testnet shortcuts** → [production-readiness.md](./production-readiness.md).

This rule exists because it was broken. In August 2026 "swaps are deferred" appeared 11 times across four files, the fee-payer paragraph four times, and the custody model five. Four docs then went a month without an update while five features shipped, and the duplicates disagreed. The [`CONTRIBUTING.md`](../CONTRIBUTING.md) "if you change X, update Y" table is the guard against a repeat.
