# `pocketlet-escrow`

Last reviewed: 2026-09-17

The Soroban contract behind **claimable links** — sending money to someone who does not have a wallet yet. It holds a deposit against the hash of a secret; whoever presents the secret can claim it, and the sender can refund it after expiry.

Design rationale: [ADR 0006](../../docs/decisions/0006-escrow-claim-link-design.md). How it fits the wider flow: [architecture.md](../../docs/architecture.md#claimable-links).

## Build and test

```bash
cd contracts
cargo test                 # 12 unit tests
stellar contract build     # -> target/wasm32v1-none/release/pocketlet_escrow.wasm
```

Requires Rust and [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup) 27+. `soroban-sdk` 22, target `wasm32v1-none`, `overflow-checks` on in release.

Deploy with `pnpm run deploy:contract` (wraps `contracts/deploy.sh`, honouring `STELLAR_NETWORK` and `STELLAR_DEPLOYER_KEY_NAME`), or let CI do it from the `staging` branch. Afterwards set `NEXT_PUBLIC_ESCROW_CONTRACT_ID` to the new address — nothing propagates it automatically.

## Interface

### `deposit(sender, token, amount, claim_hash, recipient_id_hash, expiry)`

Moves `amount` of `token` from `sender` into the contract.

| Parameter | Type | Meaning |
| --- | --- | --- |
| `sender` | `Address` | The depositor. Must authorize. |
| `token` | `Address` | SAC contract for USDC or XLM. |
| `amount` | `i128` | Base units. Must be positive. |
| `claim_hash` | `BytesN<32>` | SHA-256 of the secret. |
| `recipient_id_hash` | `BytesN<32>` | SHA-256 of the recipient's phone or email. |
| `expiry` | `u64` | **Ledger sequence** after which the deposit is refundable. Must be in the future. |

Panics if a deposit with the same `claim_hash` already exists, if `amount <= 0`, or if `expiry` is not in the future. Emits `deposit`.

### `claim(secret, recipient_wallet)`

Hashes `secret` on chain, looks up the matching deposit, and transfers the full amount to `recipient_wallet`.

Panics if no deposit matches, if it is already claimed, or if the current ledger is past `expiry`. Emits `claim`.

Note there is no authorization check on the claimer — **possession of the secret is the authorization.** That is the point of a bearer link.

### `refund(claim_hash)`

Returns the deposit to the original sender and deletes it. The sender must authorize, and the current ledger must be **past** `expiry`.

Panics if no deposit matches, if it is already claimed, or if it has not expired. Emits `refund`.

### `get_deposit(claim_hash) -> Option<Deposit>`

Read-only lookup. Returns `None` for an unknown or refunded `claim_hash`.

## Storage

One entry per deposit, in **persistent** storage under `DataKey::Deposit(BytesN<32>)` keyed by `claim_hash`:

```rust
pub struct Deposit {
    pub sender: Address,
    pub token: Address,
    pub amount: i128,
    pub recipient_id_hash: BytesN<32>,
    pub expiry: u64,          // ledger sequence
    pub claimed: bool,
}
```

A claimed deposit is **kept** with `claimed: true`, which is what prevents double claims. A refunded deposit is **removed**, so the same `claim_hash` could be reused afterwards — in practice secrets are random, so this does not arise.

No TTL extension is implemented. A deposit left unclaimed long enough for its persistent entry to be archived would need restoring before it could be claimed or refunded.

## Things to know before changing it

**`expiry` is a ledger sequence here, a timestamp in Postgres.** `claim_links.expiry` is `timestamptz`; the conversion is done ad hoc in `api/wallet/claim-links/create/route.ts`. Change one side and you must change the other.

**Errors are string panics, not error codes.** The contract uses `assert!` and `expect` rather than a `#[contracterror]` enum, so callers get panic messages instead of typed codes. Worth migrating.

**The tests do not check *which* panic.** All 12 use bare `#[should_panic]` with no `expected = "..."` string, so a test can pass on the wrong panic. Add the string whenever you touch one.

**The test helper uses a deprecated API.** `env.register_stellar_asset_contract` is deprecated in `soroban-sdk` 22, and `default_ledger_info()` pins `protocol_version: 20`.

The TypeScript mirror of this interface is `apps/web/src/lib/contracts/escrow.ts`, which documents the contract-to-frontend mapping per function. Keep the two in step.
