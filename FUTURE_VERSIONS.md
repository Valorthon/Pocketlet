# Future Versions Roadmap

This document records features that were intentionally deferred from V1 and the rationale behind each decision. Items are grouped by target version, but priorities may shift as the product and market evolve.

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

## V2+ — Platform Maturity

### Mainnet Deployment
* **What:** Move from Stellar Testnet to Mainnet.
* **Why deferred:** Requires security audits, fee sponsorship budget, liquidity planning, and regulatory clarity.

### Tagalog / Filipino Localization
* **What:** Full Tagalog/Filipino language support in the app.
* **Why deferred:** English-only launch reduces initial complexity. Localization can be added once core flows are validated.

### Biometric Authentication
* **What:** Use device biometrics (fingerprint/face) in addition to or instead of PIN for transaction confirmation.
* **Why deferred:** PIN is sufficient for V1. Biometrics can be layered on later.

### Push Notifications
* **What:** Notify users of incoming payments, successful swaps, and security events.
* **Why deferred:** PWA push notifications require additional setup and are not critical for core V1 flows.

### Merchant Dashboard
* **What:** A separate interface for merchants to receive and reconcile crypto-settled QR Ph payments.
* **Why deferred:** Tied to QR Ph merchant launch.

---

## Rationale Summary

V1 is intentionally narrow so the team can:
1. Launch a working abstracted wallet on Stellar Testnet.
2. Validate passkey-based custody and P2P transfer UX.
3. Prove USDC ↔ XLM swap flows before adding fiat complexity.
4. Build a clean contract and SDK foundation that makes V2 integrations (Anchor, QR Ph, PHPC) easier to add.

For each deferred feature, this document will be updated with implementation notes as planning for V2 begins.

---

## V1 Testnet Shortcuts & Production Gaps

These are intentional simplifications in the current V1 testnet implementation that must be hardened before mainnet or a production launch.

### Email verification
- **Current behavior:** The signup API returns the verification code in the JSON response so testing works without a mail server.
- **Future work:** Integrate a transactional email provider (e.g., Resend, SendGrid, AWS SES) and remove the code from the API response.

### Platform deployer key
- **Current behavior:** If `PLATFORM_SECRET_KEY` is not set, the server generates a random testnet keypair and funds it automatically on startup.
- **Why it exists:** The deployer pays for smart-wallet WASM upload and contract deployment and acts as the `recovery_admin` for lost-passkey recovery.
- **Future work:** Require a fixed, funded, persistent deployer account in production and store its secret in a secrets manager.

### DEX swap integration
- **Current behavior:** The smart wallet accepts a DEX contract address and calls `swap(...)`. The unit tests use a tiny `mock_dex` contract.
- **Future work:** Replace the mock with a real Stellar DEX path-payment contract or AMM pool and add slippage/quote handling in the frontend.

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
