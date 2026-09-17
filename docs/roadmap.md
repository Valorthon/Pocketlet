# Roadmap

Last reviewed: 2026-09-17

Features intentionally deferred from V1, and why. V1 is a global wallet for USDC and XLM on testnet. V2 focuses on the Philippines (PHP stablecoin, fiat rails, QR Ph). V3 expands to multiple stablecoins and further regional markets. Priorities may shift.

What currently works is in the [README feature table](../README.md#features). What blocks mainnet is in [production-readiness.md](./production-readiness.md). Unscheduled speculation is in [ideas.md](./ideas.md).

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

### Seed Phrase Export UI
* **What:** A dedicated UI for advanced users to view/export their wallet's recovery seed phrase at any time after onboarding.
* **V1 status:** Every V1 user already receives a BIP39 recovery phrase during onboarding and can use it for lost-passkey recovery (see issue #33). The phrase is generated client-side and never touches the server.
* **Why deferred:** A standalone export/view flow is deferred to V2 to keep the V1 onboarding UX simple.

### Self-Custody Import
* **What:** Allow users to import an existing Stellar account via seed phrase or hardware wallet.
* **Why deferred:** Importing external keys increases support burden and is not required for the core V1 passkey wallet experience.

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

### Progressive Web App (PWA)
* **What:** Package the web app as an installable PWA with a web app manifest, service worker, offline caching, and home-screen icons.
* **Why deferred:** V1 focuses on validating the core wallet flows in the browser. A full PWA layer (manifest, icons, service worker, offline handling) can be added once the feature set is stable.

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
* **Why deferred:** Swaps are disabled in the passkey-kit migration. Real cross-asset swaps need quote handling, slippage protection, and liquidity evaluation on a live Stellar DEX/AMM.

### Additional Regional Markets
* **What:** Expand fiat on-ramp/off-ramp and localized payment methods beyond the Philippines (e.g., SEPA, PIX, local bank transfers).
* **Why deferred:** Each region requires separate Anchor or PSP partnerships, compliance review, and localization.

---

## Rationale Summary

V1 is intentionally narrow so the team can:
1. Launch a working abstracted wallet on Stellar Testnet.
2. Validate passkey-based custody and P2P transfer UX globally.
3. Validate SAC token transfers and fee-payer submission with passkey-kit smart accounts.
4. Build a clean SDK foundation that makes V2 integrations (Anchor, QR Ph, PHPC) and V3 multi-stablecoin expansion easier to add.

USDC ↔ XLM swaps were stubbed in the passkey-kit migration because the passkey-kit smart account cannot authorize classic `PathPayment` operations. Swaps will be reintroduced in a future version once a real Stellar DEX/AMM integration is rebuilt around SAC or Soroban DEX flows.

## Open product decisions

**Fee model.** The platform currently *absorbs* Stellar network fees through the fee payer, with no cost recovery and no markup — see [architecture.md](./architecture.md#why-there-is-a-fee-payer). A user-pays model, where fees are baked into the transaction and shown before confirmation, is a plausible V2 decision but is **not** implemented and not committed to. Earlier versions of the product spec described it as current behaviour; that was never true.
