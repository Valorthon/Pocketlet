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
| Look up an environment variable | [`apps/web/.env.example`](../apps/web/.env.example) |
| Work with the database | [`apps/web/src/lib/db/schema.ts`](../apps/web/src/lib/db/schema.ts) |
| Run tests, or test a flow end to end | [testing.md](./testing.md) |
| Deploy, roll back, or debug prod | [operations.md](./operations.md) |
| Understand what the product is for | [product-spec.md](./product-spec.md) |
| See which version a feature belongs to | [roadmap.md](./roadmap.md) |
| Know what blocks mainnet | [production-readiness.md](./production-readiness.md) |
| Know why something was built this way | [decisions/](./decisions/README.md) |
| Work on the smart contract | [`contracts/escrow/README.md`](../contracts/escrow/README.md) |

Speculative, unscheduled thinking lives in [ideas.md](./ideas.md). Market positioning lives in [research/competitive-analysis.md](./research/competitive-analysis.md). Neither is a commitment.

## How these docs are maintained

Every doc carries a `Last reviewed:` date. Bump it when you verify or revise the content.

Each fact has one home and other docs link to it rather than restating. Where
those homes are — and what to update when you change something — is the
["if you change X, update Y" table in `CONTRIBUTING.md`](../CONTRIBUTING.md#if-you-change-x-update-y),
which is the only copy of that list.

The rule exists because it was broken: in August 2026 four docs went a month
without an update while five features shipped, and the duplicated copies
disagreed with each other.
