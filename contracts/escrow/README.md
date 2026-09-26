# `pocketlet-escrow`

Last reviewed: 2026-09-26

The Soroban contract behind **claimable links** — sending money to someone who does not have a wallet yet. It holds a deposit against the hash of a secret; whoever presents the secret can claim it, and the sender can refund it after expiry.

`src/lib.rs` documents every function and parameter inline — read it for the interface. Why it is shaped this way: [ADR 0006](../../docs/decisions/0006-escrow-claim-link-design.md). How it fits the wider flow: [architecture.md](../../docs/architecture.md#claimable-links). Build and deploy commands: [`AGENTS.md`](../../AGENTS.md#commands).

`deposit` / `claim` / `refund` / `get_deposit`, keyed by `claim_hash`, with events on all three mutations.

## Events

Each mutation publishes one event, declared with `#[contractevent]` so the shape is
part of the contract spec and bindings generators can see it. Every event carries a
single fixed topic and a positional vec of data fields — `data_format = "vec"`, not
the macro's default map, so the wire shape matches what the contract emitted before
the macro existed.

| Function | Topic | Data vec, in order |
| --- | --- | --- |
| `deposit` | `deposit` | `claim_hash`, `sender`, `token`, `amount`, `recipient_id_hash`, `expiry` |
| `claim` | `claim` | `claim_hash`, `recipient_wallet`, `amount` |
| `refund` | `refund` | `claim_hash`, `sender`, `amount` |

`test_event_shapes_are_stable` pins all three shapes against literals, so switching
to the macro defaults fails the suite rather than changing the wire format quietly.
It deliberately does not compare against `Event::to_xdr`, which would build the
expected value with the same codegen as the actual one and so never catch the change.

Nothing off-chain reads these today — `apps/web` classifies claim-link activity from
Horizon operation parameters, not events.

## Things the source cannot tell you

**`claim` has no authorization check — possession of the secret *is* the authorization.** There is no `require_auth()` on the claimer, deliberately: a claim link is a bearer instrument, and the recipient has no wallet to authorize with when it is created. You cannot grep for a call that is not there, so this reads as a missing check unless you know it is the design. Anyone holding the link holds the funds, which is why the secret is encrypted at rest on the server side.

**Claimed and refunded deposits are stored differently.** A claimed deposit is **kept** with `claimed: true` — that flag is what prevents a double claim. A refunded deposit is **removed** entirely, so its `claim_hash` could in principle be reused. Secrets are random, so this does not arise in practice, but do not assume "no entry" means "never existed".

**There is no TTL extension.** Persistent storage entries can be archived. A deposit left unclaimed long enough would need its entry restored before it could be claimed or refunded. This is the classic Soroban escrow footgun and nothing in the source hints at it.

**`expiry` changes units at the boundary.** A **ledger sequence** here; a **timestamp** in `claim_links.expiry` in Postgres. The conversion is ad hoc in `api/wallet/claim-links/create/route.ts` — change one side and you must change the other.

**Errors are string panics, not error codes.** The contract uses `assert!` and `expect` rather than a `#[contracterror]` enum, so callers get panic messages instead of typed codes. Worth migrating.

## The TypeScript mirror

`apps/web/src/lib/contracts/escrow.ts` mirrors this interface and carries a per-function `Contract:` / `Frontend:` mapping. Keep the two in step.
