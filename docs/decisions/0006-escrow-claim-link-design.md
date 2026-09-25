# 0006. Hash-based escrow for claimable links

Status: Accepted
Date: 2026-08-29 (recorded retrospectively 2026-09-17)

## Context

A P2P wallet has a cold-start problem: a user can only pay people who already have wallets. The fix is to let someone send to a recipient who has not signed up yet — the mechanic that drove Venmo-style growth.

Doing that without becoming custodial is the hard part. The platform must not hold the funds while they wait to be claimed, and it must not learn more about the recipient than it needs to.

## Decision

A first-party Soroban contract, `contracts/escrow`, holding deposits against a hashed secret.

- The sender's client generates a random secret. The server stores it **encrypted** (`claim_links.secret_ciphertext`, keyed by `CLAIM_SECRET_ENCRYPTION_KEY`) and the contract stores only its SHA-256 hash.
- `deposit(sender, token, amount, claim_hash, recipient_id_hash, expiry)` moves tokens into the contract. The recipient's phone or email is stored only as a hash.
- `claim(secret, recipient_wallet)` re-hashes the secret on chain, matches it against stored deposits, and releases the funds.
- `refund(claim_hash)` returns funds to the sender after expiry, and only to the sender.

## Consequences

Funds sit in a contract, not in a platform account — the non-custodial property survives. The contract never sees a secret, a phone number, or an email; only hashes. Deposits cannot be stranded, because expiry plus refund always gives the sender a way back.

Anyone holding the link holds the funds. That is inherent to a bearer instrument and is the reason the secret is encrypted at rest rather than stored plainly.

Two rough edges to be aware of:

- **The `expiry` unit changes across the boundary.** The contract takes a **ledger sequence**; `claim_links.expiry` in Postgres is a **timestamp**. Conversion happens ad hoc in `api/wallet/claim-links/create/route.ts`.
- **The contract panics with strings** via `assert!` and `expect` rather than a `#[contracterror]` enum, so callers get panic messages instead of typed error codes. The unit tests now pin each panic with an `expected =` string, so a test can no longer pass on the wrong panic.

This contract is also, since [0001](./0001-passkey-kit-smart-accounts.md), the only first-party Soroban code in the repo.

## Alternatives considered

**Custodial holding account** — far simpler, and it would make the platform a money transmitter. Rejected.

**Pre-deploying a wallet for the recipient** — requires a passkey the recipient does not have yet.

**Storing the secret in the link only, with no server copy** — better privacy, but the sender could never recover or resend a lost link. The encrypted-at-rest copy is the compromise.
