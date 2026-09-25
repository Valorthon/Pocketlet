# Architecture

Last reviewed: 2026-09-25

The canonical description of how Pocketlet works. Other docs link here rather than restating the custody model or fee-payer mechanics.

## The whole picture

```
  Browser
  ┌──────────────────────────────────────────┐
  │  WebAuthn passkey  (Secp256r1, on-device)│
  │  BIP39 phrase      (generated client-side,│
  │                     never transmitted)    │
  │  passkey-kit       builds + signs the     │
  │                    invoke_host_function op│
  └───────────────┬──────────────────────────┘
                  │  signed, user-authorized op
                  ▼
  Next.js API routes (apps/web/src/app/api)
  ┌──────────────────────────────────────────┐
  │  session (JWT) · PIN check · recovery     │
  │  recipient resolution · claim-link records│
  └───┬──────────────────────────────┬───────┘
      │                              │
      ▼                              ▼
  PostgreSQL                    Fee payer (server-held account)
  users, user_devices,          rate limit checked first (rate_limits),
  claim_links, notifications,   then rebuilds the op with itself as source,
  metrics, rate_limits          re-simulates for current resource fees,
                                signs the envelope, submits
                                       │
                                       ▼
                            Soroban RPC  ──────────┐
                                                    │
        ┌───────────────────────────────────────────┤
        ▼                    ▼                      ▼
  User smart wallet    USDC / XLM SACs        Escrow contract
  (passkey-kit,        (balances, transfers)  (claimable links)
   one per user)

  Horizon ── read-only: transaction history
```

## Custody

Each user gets their **own** passkey-kit Soroban smart wallet, deployed on first use. The platform never holds a user signing key, and there is no pooled custody.

Signers on a user's wallet:

1. **Primary passkey** — a WebAuthn credential (Secp256r1). Device-bound or platform-synced, depending on the user's device.
2. **Recovery phrase** — a BIP39 mnemonic on Stellar derivation path `m/44'/148'/0'`, generated in the browser during onboarding and never sent to the server. The server stores only the derived public key.
3. **Backup passkey** — optional, registered from the profile screen.
4. **Device key** — a short-lived Ed25519 signer registered per device so routine sends need only a PIN rather than a biometric prompt. Rows live in `user_devices` with an explicit `expires_at`.

If a user loses the passkey, the backup passkey, *and* the recovery phrase, the account is unrecoverable. That is inherent to the model.

**Recovery** requires email verification plus a waiting period (`RECOVERY_WAITING_PERIOD_MS`, default 24h), then a signature from the recovery phrase or backup passkey that adds a new passkey as a signer and removes the lost one. Email verification alone cannot rotate signers.

## Why there is a fee payer

Soroban requires the transaction source account to hold XLM for fees. Users of a "digital dollars" wallet shouldn't have to acquire XLM before they can move USDC, so the platform absorbs network fees.

`FEE_PAYER_SECRET_KEY` is a server-held Stellar account that takes an operation the user has **already authorized**, rebuilds the transaction with itself as the source account, re-simulates to pick up current resource fees, signs the envelope, and submits it to Soroban RPC.

The security property that matters: **the fee payer is not a signer on any user wallet.** It cannot originate a transfer or move user funds. It only pays for the inclusion of operations users have already signed. Rotating it requires no action from users.

On testnet, if `FEE_PAYER_SECRET_KEY` is unset the server generates a keypair and funds it via Friendbot on first use. On the public network it is required and the app fails fast without it.

> **Fees are currently absorbed, not recovered.** There is no markup and no cost-recovery mechanism in the code. A user-pays model is a future decision, tracked in [roadmap.md](./roadmap.md) — not something the current implementation does.

Sponsorship via OpenZeppelin Channels was evaluated and deferred; see [ADR 0003](./decisions/0003-fee-payer-resubmission.md).

## Money movement

**Balances** are read from the USDC and XLM Stellar Asset Contracts through passkey-kit's `SACClient`.

**Transfers** are SAC token transfers, authorized by the user's passkey, then submitted by the fee payer. A PIN check gates the flow at the application layer before anything is signed; on-chain authorization is enforced by the smart wallet's `__check_auth`.

**Recipients** resolve in this order (`src/lib/wallet/recipient.ts`): raw Stellar address (`G…` or `C…`) → phone number → username → email. Email lookup normalizes to lowercase, so case does not matter. If nothing resolves and the app has contact details, the send becomes a claimable link instead — which is still what genuinely unregistered emails, and registered users whose wallet is not deployed yet, fall through to.

**Transaction history** is read from Horizon and classified into receive, send, and claim-link activity. Swap classification was removed with the swap feature.

## Claimable links

Sending to someone with no wallet:

1. The sender's client generates a random secret. The server stores it encrypted (`claim_links.secret_ciphertext`, key `CLAIM_SECRET_ENCRYPTION_KEY`) and keeps only a SHA-256 hash on chain.
2. The sender authorizes `deposit(...)` on the escrow contract, moving tokens into escrow against `claim_hash` and a hashed recipient identifier.
3. The recipient opens the link, creates an account and wallet, and calls `claim(secret, recipient_wallet)`. The contract re-hashes the secret, matches it, and releases the funds.
4. If nobody claims before expiry, the sender calls `refund(claim_hash)`.

The contract only ever sees hashes — never the secret, never a phone number or email.

The contract interface, and the traps in it — including the fact that `expiry` means something different on each side of the boundary — are in [`contracts/escrow/README.md`](../contracts/escrow/README.md).

## Storage

PostgreSQL via Drizzle ORM. The schema and its caveats live in `apps/web/src/lib/db/schema.ts`; migrations in `apps/web/drizzle/` are applied at boot ([ADR 0005](./decisions/0005-migrate-on-boot.md)).

Only one thing remains on disk: the testnet `fee_payer_secret`, under `POCKETLET_DATA_DIR`.

## Deliberate constraints

**Blockchain details stay hidden.** Public keys, resource fees, and crypto vocabulary appear in the Transaction Details view and nowhere else in the normal flows. This is a product constraint, not a styling preference.

**Testnet only.** V1 does not custody funds in a regulated sense, perform KYC, or touch fiat. Anchors, SEP-24 on/off-ramps, and SEP-38 quotes are V2 concerns.

**No Anchor integration.** Recipient addressing uses an internal username/phone mapping rather than SEP-2 federation.
