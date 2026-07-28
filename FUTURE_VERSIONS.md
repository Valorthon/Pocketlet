# Future Versions Roadmap

This document records features that were intentionally deferred from V1 and the rationale behind each decision. V1 is positioned as a global wallet for USDC and XLM. V2 focuses on the Philippines market (PHP stablecoin, fiat rails, QR Ph). V3 expands to multi-stablecoin support and additional regional markets. Priorities may shift as the product and market evolve.

---

## V2 — Fiat On-Ramp & PHPC Support

### PHP Stablecoin (PHPC)
* **What:** Support for Philippine Peso stablecoins such as PHPC (Coins.ph) or other BSP-registered PHP tokens on Stellar.
* **Why deferred:** V1 focuses on a simpler USD (USDC) and XLM experience. Adding PHP introduces FX quoting, local compliance, and Anchor dependencies that extend the launch timeline.

### Fiat On-Ramp (PHP → Stablecoin)
* **What:** Allow users to deposit PHP via local payment rails (InstaPay, GCash, Bank Transfer) and receive PHPC or USDC through a licensed Stellar Anchor.
* **Why deferred:** Requires a commercial agreement with a licensed Anchor and integration with SEP-24 hosted deposit flows.
* **Partner candidates:** Coins.ph, PeraHub, or other Stellar Anchors operating in the Philippines.

### SEP-24 Hosted Deposit/Withdrawal
* **What:** Implement SEP-24 flows for on-ramp and off-ramp interactions with Anchors.
* **Why deferred:** Depends on selecting and contracting an Anchor partner.

---

## V2 — QR Ph Off-Ramp & Merchant Payments

### QR Ph Scan-and-Pay
* **What:** User scans a Philippine QR Ph code at a merchant and pays using their crypto balance. The merchant receives PHP in their bank/e-wallet account.
* **Why deferred:** This is the headline feature but requires a licensed settlement partner that can send InstaPay/PESONet on behalf of the platform, plus robust failure handling and reconciliation.
* **Settlement options to evaluate:**
    * Stellar Anchor with local PHP settlement rails
    * Payment service providers such as Xendit or PayMongo
    * Partnership with an existing e-wallet acting as the sending wallet

### Fiat Off-Ramp (Stablecoin → PHP)
* **What:** Convert USDC/PHPC to PHP and withdraw to a local bank or e-wallet.
* **Why deferred:** Requires Anchor/PSP integration and local compliance alignment.

### SEP-38 Quotes
* **What:** Get quoted exchange rates when paying a PHP QR code with a USDC balance.
* **Why deferred:** Tied to QR Ph off-ramp and Anchor integration.

### Merchant Dashboard
* **What:** A separate interface for merchants to receive and reconcile crypto-settled QR Ph payments.
* **Why deferred:** Tied to QR Ph merchant launch.

---

## V2 — Federation & Public Addressing

### SEP-2 Federation Server
* **What:** Run a federation server so Pocketlet users can be reached by `username*pocketlet.com` from any Stellar wallet.
* **V1 decision:** V1 uses an internal username/phone mapping for P2P inside the app.
* **Why deferred:** SEP-2 adds infrastructure and public exposure considerations. It becomes valuable once the user base grows and interoperability with external wallets is desired.

---

## V2 — Self-Custody

### Seed Phrase Export
* **What:** Allow advanced users to export their wallet's seed phrase and manage keys outside the app.
* **Why deferred:** Abstracted passkey custody is the safer default for non-crypto users. Self-custody introduces key management risks and support burden.

### Self-Custody Import
* **What:** Allow users to import an existing Stellar account via seed phrase or hardware wallet.
* **Why deferred:** Same reasoning as seed phrase export.

---

## V1+ — Global Platform Maturity

### Biometric Authentication
* **Tracking issue:** #26
* **What:** Use device biometrics (fingerprint/face) in addition to or instead of PIN for transaction confirmation.
* **Why deferred:** PIN is sufficient for V1. Biometrics can be layered on later.

### Push Notifications
* **Tracking issue:** #27
* **What:** Notify users of incoming payments, successful swaps, and security events.
* **Why deferred:** PWA push notifications require additional setup and are not critical for core V1 flows.

---

## V3 — Multi-Stablecoin Support & Regional Expansion

### Multi-Stablecoin Balances
* **What:** Hold and transact in multiple stablecoins beyond USDC (e.g., USDT, EURC, other fiat-backed tokens on Stellar).
* **Why deferred:** V1 intentionally keeps the asset model simple (USDC + XLM) to validate the core wallet experience before introducing asset registries, per-asset decimals, and multi-pair swap routing.

### Configurable Asset Registry
* **What:** A runtime or environment-driven registry of supported assets per network/region, including symbol, name, contract ID, decimals, and display metadata.
* **Why deferred:** Requires a stable architecture for network-aware configuration and UI asset selection before adding more tokens.

### Cross-Asset Swaps
* **What:** Swap between any supported stablecoin pair (not only USDC ↔ XLM), integrated with a real Stellar DEX/AMM.
* **Why deferred:** The bundled `mock_dex` is 1:1 and only suitable for testnet demo swaps. Real cross-asset swaps need quote handling, slippage protection, and liquidity evaluation.

### Additional Regional Markets
* **What:** Expand fiat on-ramp/off-ramp and localized payment methods beyond the Philippines (e.g., SEPA, PIX, local bank transfers).
* **Why deferred:** Each region requires separate Anchor or PSP partnerships, compliance review, and localization.

---

## Rationale Summary

V1 is intentionally narrow so the team can:
1. Launch a working abstracted wallet on Stellar Testnet.
2. Validate passkey-based custody and P2P transfer UX globally.
3. Prove USDC ↔ XLM swap flows before adding fiat complexity.
4. Build a clean contract and SDK foundation that makes V2 integrations (Anchor, QR Ph, PHPC) and V3 multi-stablecoin expansion easier to add.

For each deferred feature, this document will be updated with implementation notes as planning for V2 and V3 begins.

---

## V1 Testnet Shortcuts & Production Gaps

These are intentional simplifications in the current V1 testnet implementation that must be hardened before mainnet or a production launch.

**Tracking issue:** #25

### Email verification
- **Issue:** #18
- **Current behavior:** The signup API returns the verification code in the JSON response so testing works without a mail server.
- **Future work:** Integrate a transactional email provider (e.g., Resend, SendGrid, AWS SES) and remove the code from the API response.

### Platform deployer key
- **Issue:** #19
- **Current behavior:** If `PLATFORM_SECRET_KEY` is not set, the server generates a random testnet keypair and funds it automatically on startup.
- **Why it exists:** The deployer pays for smart-wallet WASM upload and contract deployment and acts as the `recovery_admin` for lost-passkey recovery.
- **Future work:** Require a fixed, funded, persistent deployer account in production and store its secret in a secrets manager.

### DEX swap integration
- **Issue:** #20
- **Current behavior:** The smart wallet accepts a DEX contract address and calls `swap(...)`. The unit tests use a tiny `mock_dex` contract.
- **Future work:** Replace the mock with a real Stellar DEX path-payment contract or AMM pool and add slippage/quote handling in the frontend.

### Smart wallet authorization
- **Issue:** #21
- **Current behavior:** The wallet contract's `transfer` function does not call `require_auth()`, so it relies entirely on the platform relayer's off-chain session + PIN checks. The `swap` function does enforce authorization.
- **Why it exists:** Removing on-chain auth was a testnet shortcut to get XLM transfers working through the relayer flow.
- **Future work:** Add consistent on-chain authorization to `transfer` (or route transfers through an authenticated relayer entrypoint) before mainnet.

### Custody of wallet owner secret keys
- **Issue:** #22
- **Current behavior:** The wallet owner's Ed25519 secret key is generated server-side during deployment and stored in `apps/web/.data/users.json`.
- **Future work:** Move key generation and storage to a secure enclave, HSM, MPC service, or encrypted secrets manager. Do not store plaintext private keys alongside user records.

### Development-only secrets and defaults
- **Issue:** #23
- **Current behavior:** `.env.example` ships with `SESSION_SECRET=change-me-in-production`, `WEBAUTHN_RP_ID=localhost`, and `WEBAUTHN_ORIGIN=http://localhost:3000`. The session signing secret also falls back to a hardcoded dev value in code.
- **Future work:** Require production-grade secrets at startup (fail fast if missing), enforce HTTPS origins for WebAuthn, and document rotation procedures.

### Local file-based storage
- **Issue:** #24
- **Current behavior:** Users, deployer secrets, and the cached DEX contract ID are stored in `.data/*.json` files on disk.
- **Future work:** Replace file storage with a real database for user records and a secrets manager for sensitive keys.

### Remaining V1 issues
All tracked V1 MVP sub-issues have been implemented:

- ~~Scaffold monorepo with pnpm workspace (issue #5)~~ ✅ Completed
- ~~Implement Soroban smart wallet contract with passkey signer (issue #6)~~ ✅ Completed
- ~~Implement email + passkey authentication flow (issue #8)~~ ✅ Completed
- ~~Implement smart wallet deployment and receive screen (issue #9)~~ ✅ Completed
- ~~P2P transfers by username, phone, or raw address (issue #10)~~ ✅ Completed
- ~~Implement USDC ↔ XLM swaps via Stellar DEX (issue #11)~~ ✅ Completed
- ~~Implement transaction history and details view (issue #12)~~ ✅ Completed
- ~~Implement PIN confirmation for payments and swaps (issue #13)~~ ✅ Completed
- ~~Implement lost passkey recovery flow (issue #14)~~ ✅ Completed
- ~~End-to-end testnet testing and documentation update (issue #15)~~ ✅ Completed
