# 0001. Passkey-kit smart accounts over a custom smart wallet

Status: Accepted
Date: 2026-08-24 (recorded retrospectively 2026-09-17)

## Context

V1 originally shipped a custom Soroban smart-wallet contract. Two problems surfaced in review:

- The contract's `transfer` did not call `require_auth()` (issue #21), so it relied entirely on the platform's off-chain session and PIN checks. Anyone who could reach the relayer could move funds.
- The wallet owner's Ed25519 secret was generated server-side and stored in plaintext in `users.json` (issue #22). The platform was custodial in practice, contradicting the product's core claim.

Both are fixable, but fixing them means building and maintaining a WebAuthn-verifying smart wallet — Secp256r1 signature verification, signer rotation, recovery — which is security-critical contract code with no in-house audit budget.

## Decision

Delete the custom smart wallet and adopt [`passkey-kit`](https://github.com/stellar/passkey-kit) smart accounts (issue #33). The primary signer is a WebAuthn credential; authorization is enforced on chain by the wallet's `__check_auth`.

## Consequences

The platform no longer holds user signing keys, which makes "abstracted self-custody" true rather than aspirational. On-chain authorization comes free and correct. Recovery is a signer-rotation problem: a client-generated BIP39 phrase and an optional backup passkey can add a new passkey and remove a lost one.

Costs: a dependency on passkey-kit's release cadence and its canonical WASM hash (`NEXT_PUBLIC_WALLET_WASM_HASH`), which must be installed on whichever network is targeted.

It also broke swaps. The passkey-kit smart account cannot authorize classic `PathPayment` operations, so USDC ↔ XLM swaps were disabled and remain so — the most visible casualty of this decision. See [production-readiness.md](../production-readiness.md).

Because the repo then contained no custom contract of its own, the escrow contract ([0006](./0006-escrow-claim-link-design.md)) is now the only first-party Soroban code.

## Alternatives considered

**Harden the custom wallet** — add `require_auth()` and move owner keys to a KMS. Rejected: still custodial, and still unaudited security-critical contract code.

**Classic Stellar accounts with a server-held signer** — simpler, but plainly custodial and incompatible with the product's positioning.
