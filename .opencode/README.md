# Vendored agent skills

Last reviewed: 2026-09-17

`skills/` holds a vendored copy of the **`stellar-dev` skill pack** — reference documentation on Soroban contracts, dApp development, Stellar data access, assets, agentic payments, standards/SEPs, and ZK proofs.

It was added on 2026-07-19 for the [opencode](https://opencode.ai) agent and has not been re-synced since. Roughly 4,500 lines.

## Using it

Consult these before designing Stellar or Soroban work — they cover SEP selection, SAC semantics, contract testing and security patterns, and passkey/smart-account details that are easy to get subtly wrong. `smart-contracts/` has the most depth: `development.md`, `testing.md`, and `security.md` alongside `SKILL.md`.

## Caveats

**This is third-party documentation with no recorded upstream revision.** There is no sync mechanism and no pinned version, so it may lag the current Stellar tooling. Where it disagrees with the [official Stellar docs](https://developers.stellar.org/) or with this repo's own code, trust those instead.

If your agent tooling already provides the `stellar-dev` skills natively, prefer its copy — it will be newer.

Note that `.opencode/.gitignore` excludes `package.json`, `package-lock.json`, and `node_modules`, so only `skills/` is tracked.
