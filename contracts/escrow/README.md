# `pocketlet-escrow`

Last reviewed: 2026-09-17

The Soroban contract behind **claimable links** — sending money to someone who does not have a wallet yet. It holds a deposit against the hash of a secret; whoever presents the secret can claim it, and the sender can refund it after expiry.

`src/lib.rs` documents every function and parameter inline — read it for the interface. Why it is shaped this way: [ADR 0006](../../docs/decisions/0006-escrow-claim-link-design.md). How it fits the wider flow: [architecture.md](../../docs/architecture.md#claimable-links). Build and deploy commands: [`AGENTS.md`](../../AGENTS.md#commands).

`deposit` / `claim` / `refund` / `get_deposit`, keyed by `claim_hash`, with events on all three mutations.

## Things the source cannot tell you

**`claim` has no authorization check — possession of the secret *is* the authorization.** There is no `require_auth()` on the claimer, deliberately: a claim link is a bearer instrument, and the recipient has no wallet to authorize with when it is created. You cannot grep for a call that is not there, so this reads as a missing check unless you know it is the design. Anyone holding the link holds the funds, which is why the secret is encrypted at rest on the server side.

**Claimed and refunded deposits are stored differently.** A claimed deposit is **kept** with `claimed: true` — that flag is what prevents a double claim. A refunded deposit is **removed** entirely, so its `claim_hash` could in principle be reused. Secrets are random, so this does not arise in practice, but do not assume "no entry" means "never existed".

**There is no TTL extension.** Persistent storage entries can be archived. A deposit left unclaimed long enough would need its entry restored before it could be claimed or refunded. This is the classic Soroban escrow footgun and nothing in the source hints at it.

**`expiry` changes units at the boundary.** A **ledger sequence** here; a **timestamp** in `claim_links.expiry` in Postgres. The conversion is ad hoc in `api/wallet/claim-links/create/route.ts` — change one side and you must change the other.

**Errors are string panics, not error codes.** The contract uses `assert!` and `expect` rather than a `#[contracterror]` enum, so callers get panic messages instead of typed codes. Worth migrating.

**The test helper is pinned to old APIs.** `env.register_stellar_asset_contract` is deprecated in `soroban-sdk` 22, and `default_ledger_info()` pins `protocol_version: 20`.

## The TypeScript mirror

`apps/web/src/lib/contracts/escrow.ts` mirrors this interface and carries a per-function `Contract:` / `Frontend:` mapping. Keep the two in step.
