# Environment variables

Last reviewed: 2026-09-17

The canonical list. `apps/web/.env.example` is the copyable template; this page explains what each variable does and what breaks without it. Keep the two in sync — see the ["if you change X, update Y" table](../CONTRIBUTING.md#if-you-change-x-update-y).

Start with `cp apps/web/.env.example apps/web/.env.local`. Every variable below is read from that file (or the real environment) by `apps/web`.

## Required for local development

Nothing, if you copy `.env.example` and run `docker compose up -d`. The defaults target Stellar Testnet and the local Postgres container.

Two exceptions ship empty and **throw at runtime** the moment you exercise claimable links:

| Variable | Read at | What happens if unset |
| --- | --- | --- |
| `CLAIM_SECRET_ENCRYPTION_KEY` | `src/lib/wallet/claim-secrets.ts:8` | Throws `CLAIM_SECRET_ENCRYPTION_KEY is not configured`. Generate with `openssl rand -hex 32`. |
| `NEXT_PUBLIC_ESCROW_CONTRACT_ID` | `src/lib/contracts/escrow.ts:15` | Throws `NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured`. Deploy the contract with `pnpm run deploy:contract`. |

## Stellar network

| Variable | Read at | Default |
| --- | --- | --- |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | `src/lib/wallet/network.ts:4` | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | `src/lib/wallet/network.ts:8` | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | `src/lib/auth/config.ts:10` | `Test SDF Network ; September 2015` |
| `NEXT_PUBLIC_USDC_CONTRACT_ID` | `src/lib/wallet/assets.ts:18` | Circle testnet USDC SAC |
| `NEXT_PUBLIC_WALLET_WASM_HASH` | `src/lib/wallet/passkey-kit.ts:22` | Pinned passkey-kit v1 testnet hash |

The network passphrase is what flips the app into "production" mode. Set it to the public-network passphrase and the guardrails below become hard requirements.

`NEXT_PUBLIC_WALLET_WASM_HASH` must be a WASM hash actually installed on the target network, or wallet deployment fails.

## Authentication

| Variable | Read at | Default | Notes |
| --- | --- | --- | --- |
| `SESSION_SECRET` | `src/lib/auth/config.ts:72` | `dev-secret-change-in-production` | JWT signing key. Rotating it logs everyone out and invalidates recovery tokens. |
| `WEBAUTHN_RP_ID` | `src/lib/auth/config.ts:68` | `localhost` | Passkeys are bound to this. |
| `WEBAUTHN_ORIGIN` | `src/lib/auth/config.ts:69` | `http://localhost:3000` | Must match the browser origin exactly. |
| `WEBAUTHN_RP_NAME` | `src/lib/auth/config.ts:67` | `Pocketlet` | Display name in the passkey prompt. |
| `NEXT_PUBLIC_PASSKEY_RP_ID` | `src/lib/wallet/passkey-kit.ts:30` | falls back to `WEBAUTHN_RP_ID` | Only needed when the browser origin differs from the RP ID (subdomains, reverse proxies). |
| `RECOVERY_WAITING_PERIOD_MS` | `src/lib/auth/recovery.ts:13` | `86400000` (24h) | Set to `60000` to make recovery testable. |

## Server-side

| Variable | Read at | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | `src/lib/db/index.ts:6` | `postgres://pocketlet:pocketlet@localhost:5432/pocketlet` | Matches `docker-compose.yml`. Railway injects this automatically. |
| `FEE_PAYER_SECRET_KEY` | `src/lib/auth/config.ts:58` | auto-generated on testnet | The account that pays network fees. On testnet it is generated and Friendbot-funded on first use; on the public network it is required. Not a signer on any user wallet. |
| `ADMIN_SECRET_TOKEN` | `src/lib/admin.ts:2` | `change-me-in-production` | Gates `/admin` and `/api/admin/*`. While it is the default value, auth **fails closed and silently** — `/admin` gives no hint why. |
| `CLAIM_SECRET_ENCRYPTION_KEY` | `src/lib/wallet/claim-secrets.ts:8` | none | AES key for claim-link secrets at rest. |
| `POCKETLET_DATA_DIR` | `src/lib/wallet/fee-payer.ts:9` | `.data` in the working directory | Holds **only** `fee_payer_secret`. User data moved to Postgres; the old `users.json` store is gone. |

`NEXT_RUNTIME` is set by Next.js itself (`src/instrumentation.ts:5`) — don't set it.

## Public-network guardrails

When `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` is the public-network passphrase, the app refuses to start unless `SESSION_SECRET` is non-default and ≥32 characters, `WEBAUTHN_ORIGIN` is HTTPS, `WEBAUTHN_RP_ID` is a real domain, `FEE_PAYER_SECRET_KEY` is set, and `CLAIM_SECRET_ENCRYPTION_KEY` is set.

**These checks live in two places and do not agree.** `next.config.mjs` (build time) validates `CLAIM_SECRET_ENCRYPTION_KEY` but not `FEE_PAYER_SECRET_KEY`; `src/lib/auth/config.ts` (runtime) does the reverse. Both check `SESSION_SECRET` and the WebAuthn settings. If you add a guardrail, add it to both — tracked in [production-readiness.md](./production-readiness.md).

## In production

Store `SESSION_SECRET`, `FEE_PAYER_SECRET_KEY`, `CLAIM_SECRET_ENCRYPTION_KEY`, and `ADMIN_SECRET_TOKEN` in a secrets manager rather than an env file. Generate each with `openssl rand -hex 32`. Rotating `FEE_PAYER_SECRET_KEY` needs no user action — drain and retire the old account. Rotating `SESSION_SECRET` signs everyone out.
