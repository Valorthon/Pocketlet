# Pocketlet

[![CI](https://github.com/Valorthon/pocketlet/actions/workflows/ci.yml/badge.svg)](https://github.com/Valorthon/pocketlet/actions/workflows/ci.yml)

Pocketlet is a simple web wallet for holding and sending digital dollars globally. It feels like a familiar money app, but settles on the Stellar blockchain. V1 runs on Stellar Testnet, supports USDC and XLM, and uses passkey-based abstracted custody with a Soroban smart wallet.

## Features

- **Email + passkey signup** — authenticate with a device passkey; a BIP39 recovery phrase is generated client-side for backup recovery.
- **Abstracted custody** — each user gets a Soroban smart wallet controlled by a WebAuthn/Passkey signer.
- **Receive USDC/XLM** — share a Stellar address or QR code.
- **P2P transfers** — send USDC or XLM to any Stellar address (Pocketlet users by username/phone, or raw addresses).
- **USDC ↔ XLM swaps** — *deferred to a future version* while the DEX integration is rebuilt for the passkey-kit wallet.
- **PIN confirmation** — required for all payments.
- **Transaction details** — view fees, operation details, and on-chain hash.
- **Lost-passkey recovery** — email-based recovery with a waiting period and new passkey registration.

## Project Structure

This is a pnpm monorepo:

```
.
├── apps/web                    Next.js 14 PWA frontend (App Router)
├── packages/config             Shared ESLint, TypeScript, Tailwind config
├── SPEC.md                     V1 product spec
├── FUTURE_VERSIONS.md          V2, V3, and deferred feature roadmap
├── TESTNET.md                  End-to-end testnet testing guide
└── README.md                   This file
```

## Deployed Contracts (Testnet)

These are the contracts currently deployed on Stellar Testnet for this project:

| Contract | Address | Notes |
| --- | --- | --- |
| Circle USDC SAC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | Official Circle testnet USDC Stellar Asset Contract |
| Pocketlet Smart Wallet (example) | `CA7FMXWUMM3C37O4QF4E4R4KKXZIEBV7CTFHKDRDXPBLZQ2NMC5PZC5G` | One of the wallets deployed during testnet testing |
| Pocketlet Smart Wallet (example) | `CCTTR6BVBPGWW76HFCRSPQAXZCOC4HKUF5BKK3ZDO7V7B6PIPDKP2BFQ` | Another wallet deployed during testnet testing |

Swaps are currently disabled in the UI. A DEX integration will be added in a future version.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ (LTS recommended)
- [pnpm](https://pnpm.io/) 11.13.1+ (the monorepo uses `packageManager: pnpm@11.13.1`)
- A Stellar Testnet wallet (e.g., [Laboratory](https://laboratory.stellar.org/#testnet), [LOBSTR](https://lobstr.co/), or a testnet-funded account) for end-to-end testing

## Install

```bash
pnpm install
```

## Build

No contract build is required for the web app. The passkey-kit wallet uses a canonical WASM hash configured via `NEXT_PUBLIC_WALLET_WASM_HASH`.

```bash
pnpm --filter web build
```

## Run Tests

### Frontend (unit tests)

```bash
pnpm --filter web test
```

### Lint and TypeScript

```bash
pnpm run lint
pnpm run typecheck
```

## Configure the Web App

Copy the example environment file and edit as needed:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Key variables:

| Variable | Description | Default |
| --- | --- | --- |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | Horizon REST endpoint | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | Stellar network passphrase | Testnet |
| `NEXT_PUBLIC_USDC_CONTRACT_ID` | Circle testnet USDC SAC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| `NEXT_PUBLIC_WALLET_WASM_HASH` | Canonical passkey-kit smart-wallet WASM hash | pinned testnet hash |
| `FEE_PAYER_SECRET_KEY` | Server-held fee payer secret (required on public network) | generated & funded automatically on testnet |
| `RECOVERY_WAITING_PERIOD_MS` | Lost-passkey recovery waiting period | 24 hours (set to `60000` for quick testing) |
| `WEBAUTHN_RP_ID` | WebAuthn relying party ID | `localhost` |
| `WEBAUTHN_ORIGIN` | WebAuthn origin | `http://localhost:3000` |
| `SESSION_SECRET` | JWT session signing secret | `change-me-in-production` |

## Run the App

```bash
pnpm run dev:web
```

Open `http://localhost:3000`.

For passkey registration/login to work in Chrome, you must use `localhost` (or configure HTTPS and `WEBAUTHN_RP_ID` accordingly). Passkeys are tied to origin.

## Testnet End-to-End Flow

See [`TESTNET.md`](./TESTNET.md) for a step-by-step guide to test the full V1 flow on Stellar Testnet:

1. Deploy the smart wallet
2. Receive USDC/XLM from an external testnet wallet
3. Send USDC/XLM to another account
4. Recover a lost passkey

## Architecture Overview

- **Smart wallet** — passkey-kit creates a passkey-controlled Soroban smart wallet for each user. The platform never holds the user's signing key.
- **Signer model** — the primary signer is a WebAuthn/Passkey (Secp256r1). Users also get a BIP39 recovery phrase (Stellar derivation path `m/44'/148'/0'`) and can optionally register a backup passkey.
- **Fee payer** — a server-held account (`FEE_PAYER_SECRET_KEY`) rebuilds user-authorized `invoke_host_function` operations with itself as the source account, re-simulates for current resource fees, signs the envelope, and submits directly to Soroban RPC. It covers network fees on testnet and is not a signer on any user wallet.
- **Balances** — read from the Stellar Asset Contract (SAC) for USDC and XLM via `passkey-kit`'s `SACClient`.
- **Transfers** — user-authorized SAC token transfers signed by the user's passkey and submitted by the fee payer via direct RPC.
- **Swaps** — temporarily disabled in V1 while the DEX integration is rebuilt for the passkey-kit wallet.
- **Transactions** — fetched from Horizon and classified into receive, send, and (historical) swap.

## Scripts

```bash
pnpm run dev:web            # Start the web app in dev mode
pnpm run build:web          # Build the Next.js app
pnpm run start:web          # Start the production build
pnpm --filter web test      # Run frontend unit tests
pnpm run lint               # Run ESLint on the web app
pnpm run typecheck          # Run TypeScript type checking on the web app
```

## Security Notes

- V1 is a testnet technology interface. It does not custody funds, perform KYC, or process fiat.
- User funds live in their own Soroban smart wallet.
- The platform never holds user signing keys. Passkey credentials live on the user's device; the recovery phrase is generated client-side and is never sent to the server.
- Recovery uses the BIP39 phrase or an optional backup passkey. Email verification is still required for account creation and passkey recovery, but it cannot alone rotate wallet signers.
- The fee payer (`FEE_PAYER_SECRET_KEY`) rebuilds, signs, and submits user-authorized Soroban operations, paying network fees in the process. It never holds user funds and cannot move them. Store it in a secrets manager in production.
- Email verification returns the code in the API response for testnet convenience. Replace with a real transactional email provider before production.
- On the Stellar public network, `SESSION_SECRET` is required, and `WEBAUTHN_ORIGIN` must be HTTPS with a real `WEBAUTHN_RP_ID` (not `localhost`). The app fails fast on startup if these production requirements are not met.

### Secrets rotation

Before production, establish a rotation cadence for these environment secrets:

- `SESSION_SECRET` — rotates session signing keys. Changing this invalidates all existing signed sessions and recovery tokens, forcing users to sign in again.
- `FEE_PAYER_SECRET_KEY` — rotates the Stellar account that submits user transactions. The old fee payer can be drained and retired; users do not need to rotate anything on their wallets because the fee payer is not a signer.

Store both in a secrets manager (e.g. AWS Secrets Manager, HashiCorp Vault, or 1Password Secrets Automation). For `SESSION_SECRET`, generate a fresh random value of at least 32 bytes (e.g. `openssl rand -hex 32`). Rotate during a low-traffic window and monitor for failed authentication as a signal that old sessions have expired.

## Screenshots

### Home / Balance

![Home screen showing wallet balance](./screenshots/wallet-connected-balance.png)

### Send Flow

![Send review screen](./screenshots/debug-send-review.png)

![Send PIN confirmation](./screenshots/debug-send-pin.png)

![Send confirming](./screenshots/debug-send-confirming.png)

<img width="606" height="518" alt="image" src="https://github.com/user-attachments/assets/fe0a0a74-92dd-46d1-8d49-2546d6dd79ea" />


## License

UNLICENSED — this project is in active development.
