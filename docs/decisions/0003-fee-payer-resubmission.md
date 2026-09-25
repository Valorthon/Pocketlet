# 0003. Server-held fee payer rebuilds and resubmits

Status: Accepted
Date: 2026-08-24 (recorded retrospectively 2026-09-17)

## Context

Soroban charges resource fees to the transaction's source account. A user holding only USDC cannot submit anything until they acquire XLM — which defeats a wallet whose pitch is that users never think about crypto.

The ecosystem answer is fee sponsorship. The OpenZeppelin Channels service (formerly Launchtube) does exactly this. At the time of the decision it did not support CAP-0071-02 V2 address credentials, which passkey-kit smart accounts rely on, so it could not sponsor the operations this app produces.

## Decision

Run a server-held fee payer account. It takes an operation the user has **already authorized**, rebuilds the transaction with itself as the source account, re-simulates to pick up current resource fees, signs the envelope, and submits it to Soroban RPC.

Server-side submission uses `@stellar/stellar-sdk` directly rather than `passkey-kit/server`, keeping relayer concerns out of the client bundle.

## Consequences

Users never need XLM, and the UX goal holds.

The security property that makes this acceptable: **the fee payer is not a signer on any user wallet.** It cannot originate a transfer or move user funds — it only pays for the inclusion of operations users have already signed. Rotating it requires no user action; drain the old account and retire it.

The costs are operational. The fee payer is a live key that must be funded and monitored, and it is a spend vector: the submission endpoints are rate-limited per user and per IP as of issue #36 ([ADR 0008](./0008-fee-payer-rate-limiting.md)), but the budget those limits permit is still real spend that has to be funded and watched. On testnet an unset key is auto-generated and Friendbot-funded, which is convenient locally but means the secret sits on local disk under `POCKETLET_DATA_DIR`.

Re-simulating on every submission costs an extra RPC round trip but avoids failures from stale resource-fee estimates.

## Alternatives considered

**OpenZeppelin Channels** — the right long-term answer, blocked at the time by the missing V2 address credential support. Worth revisiting; production should use a self-hosted relayer with its API key in a secrets manager.

**Make users hold XLM** — rejected outright; it is the problem the product exists to remove.

**Classic fee-bump transactions** — do not apply cleanly to Soroban `invoke_host_function` operations with smart-account authorization.
