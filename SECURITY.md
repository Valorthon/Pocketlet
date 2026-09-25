# Security Policy

Last reviewed: 2026-09-25

## Scope

Pocketlet V1 runs on **Stellar Testnet only**. Testnet assets have no monetary value, and testnet accounts are reset periodically. Nothing in this repository is audited or ready for mainnet.

The known gaps between the current code and something deployable to mainnet are tracked openly in [`docs/production-readiness.md`](./docs/production-readiness.md). Those are already-known issues — please read that list before reporting.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Use GitHub's private vulnerability reporting on the canonical repository (`Valorthon/Pocketlet`) — *Security* → *Report a vulnerability*. That creates a private advisory visible only to maintainers.

> Maintainers: private vulnerability reporting must be enabled in repository settings for that link to exist, and a contact address should be added here.

Please include what you were doing, what happened, and how to reproduce it. Since this is a testnet project with no users at risk, there is no formal response SLA and no bug bounty.

## Trust boundaries

Worth understanding before you report, because several of these look alarming and are intentional.

**The platform never holds user signing keys.** Each user's funds live in their own passkey-controlled Soroban smart wallet. The primary signer is a WebAuthn credential that never leaves the device. The BIP39 recovery phrase is generated in the browser and is never transmitted to the server.

**The fee payer cannot move user funds.** `FEE_PAYER_SECRET_KEY` is a server-held Stellar account that rebuilds already user-authorized `invoke_host_function` operations with itself as the source account, re-simulates for current resource fees, signs the envelope, and submits it. It pays network fees. It is **not** a signer on any user wallet and cannot originate a transfer. Rotating it requires no user action.

**Device keys are deliberately weaker than passkeys.** Device-key login registers a short-lived Ed25519 signer so routine sends need only a PIN rather than a biometric prompt. It is scoped and expiring by design — see the `user_devices` table.

**Claim-link secrets are encrypted at rest.** The plaintext secret for a claimable link is never stored; `claim_links.secret_ciphertext` holds it encrypted under `CLAIM_SECRET_ENCRYPTION_KEY`, and the contract only ever sees a SHA-256 hash.

## Known and accepted for testnet

These are deliberate testnet shortcuts, not findings:

- One-time codes (signup verification, PIN reset, recovery) are emailed and never returned in an API response. With no `RESEND_API_KEY` set, testnet delivers them through the log mailer, which prints the message to stdout — so on a testnet deploy anyone with log access can read a code. They expire in 15 minutes, allow five wrong guesses, and are rate limited per address and per IP.
- `FEE_PAYER_SECRET_KEY` is auto-generated and Friendbot-funded on testnet when unset. It is required on the public network, and the app refuses to start without it.
- `.env.example` ships placeholder secrets. On the Stellar public network the app fails fast if `SESSION_SECRET` is default or short, if `WEBAUTHN_ORIGIN` is not HTTPS, or if `WEBAUTHN_RP_ID` is `localhost`.
- WebAuthn registration challenges are server-generated, single-use and expire after five minutes; wallet deploy, backup passkey and recovery submit all require one. Authentication challenges are bound to the transaction payload and verified on-chain by the smart wallet.

## Handling secrets

Never commit `.env.local` or any real key. `.gitignore` covers `.env`, `.env.local`, `.env.*.local`, and `apps/web/.data/`; no secrets are tracked today. In production, store `FEE_PAYER_SECRET_KEY`, `SESSION_SECRET`, `CLAIM_SECRET_ENCRYPTION_KEY`, and `ADMIN_SECRET_TOKEN` in a secrets manager rather than environment files. Rotating `SESSION_SECRET` invalidates every existing session and recovery token.
