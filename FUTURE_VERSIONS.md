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

### Seed Phrase Export UI
* **What:** A dedicated UI for advanced users to view/export their wallet's recovery seed phrase at any time after onboarding.
* **Why deferred:** A recovery phrase is already generated during V1 onboarding and can be used for recovery (see issue #33). A standalone export/view flow is deferred to V2 to keep the V1 onboarding UX simple.

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
3. Prove USDC ↔ XLM swap flows before adding fiat complexity.
4. Build a clean contract and SDK foundation that makes V2 integrations (Anchor, QR Ph, PHPC) and V3 multi-stablecoin expansion easier to add.

For each deferred feature, this document will be updated with implementation notes as planning for V2 and V3 begins.

---

## Ideas

These are longer-term concepts and ecosystem features that may eventually become part of the roadmap but are not yet scheduled for V1, V2, or V3.

### Zero-Knowledge Credentials (ZK-KYC)

* **What:** A trusted issuer (government, KYC provider, or credential authority) signs a credential that proves identity attributes such as age or residency status. When the user interacts with a compliant DeFi pool or regulated service, the wallet generates a zero-knowledge proof that attests "I am over 18 and not a resident of a sanctioned country" without revealing the user's name, date of birth, or address.
* **Why it matters:** It lets users satisfy compliance requirements while preserving privacy, reducing the need to hand sensitive documents to every counterparty.

### Shielded Identities and Sybil Resistance

* **What:** Use "Proof of Personhood" protocols to verify that a user is a unique human (e.g., via biometric scan or social graph) and issue a ZK badge. The wallet can then prove to a DAO, airdrop contract, or voting system that "this wallet belongs to a unique human who has not voted yet" without linking the wallet to a real-world identity or to the user's other wallets.
* **Why it matters:** It reduces Sybil attacks where one person creates many wallets to claim airdrops or manipulate governance votes, while still preserving user privacy.

### Account Abstraction and Social Recovery

* **What:** Replace the simple public/private keypair model with a smart contract account. The user authenticates using the phone's secure enclave (FaceID/TouchID). If the user loses their phone, "Social Recovery" allows a set of trusted friends or a combination of email, hardware wallet, and friend approvals to rotate the keys.
* **Why it matters:** It removes the need for a seed phrase, which is a major barrier to adoption, while still giving the user a way to recover access if something goes wrong.

### Privacy Pools for Compliance

* **What:** Users deposit funds into a privacy pool. When withdrawing, they generate a zero-knowledge proof that the withdrawal is not linked to a known list of hacked or sanctioned deposits.
* **Why it matters:** Users retain financial privacy from the public, but can still cryptographically prove to regulators or exchanges that their money is clean, avoiding the regulatory issues that fully anonymous mixers have faced.

### Intent-Based Architectures

* **What:** Instead of crafting a specific transaction (e.g., "Swap 100 USDC for XLM on DEX A, paying 0.01 XLM in gas"), the user signs an intent: "I want at least 99 XLM for my 100 USDC." Solvers then compete to find the best route across liquidity pools to fulfill that intent.
* **Why it matters:** It abstracts away gas fees, routing, and complex blockchain mechanics from the end user, making the wallet feel simpler and more competitive.

### Reusable Stealth Handles (Advanced Privacy)

* **What:** Implement stealth addresses (similar to ERC-5564) on Stellar. A user publishes a public Federation address such as `bob*yourwallet.com`. When Alice sends Bob money, her wallet uses a Diffie-Hellman-style exchange combined with Bob's public handle to generate a one-time Stellar address that only Bob can control.
* **Why it matters:** Bob can share a single public handle on social media or a storefront and receive payments seamlessly, while outside observers cannot link transactions together or see his total balance.

### Link Drops and Smart Escrows

* **What:** A sender deposits funds into a Soroban escrow contract and generates a unique claim URL containing a secret hash. The recipient clicks the link, creates a wallet (e.g., with a biometric passkey), and submits the secret hash to release the funds. Unclaimed funds auto-refund to the sender after a set period (e.g., 7 days).
* **Why it matters:** It replicates Venmo-style viral onboarding without trusting a centralized database, letting users send money to anyone even before they have a wallet.

### Invisible Yield (DeFi as a Backend)

* **What:** Integrate a Stellar-native lending protocol such as Blend directly into the wallet backend. When a user toggles "Earn" on their USDC balance, the wallet supplies liquidity on their behalf and auto-compounds earnings.
* **Why it matters:** Users earn real-time yield on idle balances. Because Stellar fees are tiny, the wallet can auto-compound frequently and display live earnings in the UI.

### Programmable Pull Payments (Subscriptions)

* **What:** A Soroban contract that lets users grant allowance authorizations to specific merchants or services. For example: "Allow Spotify to pull a maximum of 15 USDC once every 30 days."
* **Why it matters:** Users get a Web2-style subscription manager where they can view and revoke auto-pay permissions, bringing recurring billing to Web3 without manually signing every payment.

### Tokenized Real-World Assets (RWAs)

* **What:** Let users swap stablecoins into tokenized real-world assets such as US Treasury bills, gold, or fractional real estate (e.g., tokenized funds already present on Stellar).
* **Why it matters:** The wallet becomes an all-in-one neobank. A user in a high-inflation economy can off-ramp into digital dollars and then park them in tokenized government bonds to protect wealth.

### Social Spending Streams

* **What:** A "Shared Pot" smart contract where a group deposits funds for a common purpose. A virtual card or delegated signing key is tied to the contract, and expenses automatically split the cost across participants in the correct proportions. A "ragequit" function lets users withdraw their unspent share instantly.
* **Why it matters:** It replaces manual bill splitting with programmable real-time splits, making group trips, events, and shared budgets easier to manage.

---

## V1 Testnet Shortcuts & Production Gaps

These are intentional simplifications in the current V1 testnet implementation that must be hardened before mainnet or a production launch.

**Tracking issue:** #25

### Email verification
- **Issue:** #18
- **Current behavior:** The signup API returns the verification code in the JSON response so testing works without a mail server.
- **Future work:** Integrate a transactional email provider (e.g., Resend, SendGrid, AWS SES) and remove the code from the API response.

### Fee payer key
- **Issue:** #19 (originally the platform deployer key; repurposed during the passkey-kit migration)
- **Current behavior:** If `FEE_PAYER_SECRET_KEY` is not set, the server generates a random testnet keypair and funds it automatically on first use.
- **Why it exists:** The fee payer submits user-signed transactions directly to Soroban RPC and covers network fees on testnet. It is not a signer on any user wallet and cannot move user funds.
- **Resolution:** On the Stellar public network, `FEE_PAYER_SECRET_KEY` is required and the app fails fast if it is missing. The testnet auto-generation path remains for local development and testnet testing.

### DEX swap integration
- **Issue:** #20
- **Current behavior:** USDC ↔ XLM swaps are temporarily disabled in the passkey-kit migration. The previous implementation relied on the deleted `packages/contracts` smart wallet and `mock_dex` contract. The `/swap` route shows a "coming soon" message and the swap API returns a disabled error.
- **Future work:** Reintroduce swaps using a real Stellar DEX/AMM integration with passkey-kit signing, quote fetching, slippage protection, and price-impact display.

### Smart wallet authorization
- **Issue:** #21
- **Previous behavior:** The wallet contract's `transfer` function did not call `require_auth()`, so it relied entirely on the platform relayer's off-chain session + PIN checks.
- **Resolution:** The migration to passkey-kit removes the custom smart-wallet contract. Authorization is now handled by the passkey-kit smart wallet's `__check_auth`, which validates WebAuthn signatures for `invoke_host_function` transactions. PIN confirmation remains an app-level gate before any transfer.

### Custody of wallet signing keys
- **Issue:** #22
- **Previous behavior:** The wallet owner's Ed25519 secret key was generated server-side during deployment and stored in plaintext inside `apps/web/.data/users.json`.
- **Resolution:** The passkey-kit migration eliminates server-held owner keys. The primary signer is a device-bound or synced WebAuthn passkey. Users also receive a client-generated BIP39 recovery phrase and may register an optional backup passkey. Neither the recovery phrase nor passkey private key material ever reaches the server.
- **Trade-off:** V1 uses passkey-kit's abstracted custody model. Before a production launch, review passkey backup policies (platform sync vs. device-bound credentials) and consider offering hardware-wallet or seed-phrase-only self-custody options for advanced users.

### Development-only secrets and defaults
- **Issue:** #23
- **Current behavior:** `.env.example` ships with `SESSION_SECRET=change-me-in-production`, `WEBAUTHN_RP_ID=localhost`, and `WEBAUTHN_ORIGIN=http://localhost:3000`. The session signing secret also falls back to a hardcoded dev value in code.
- **Future work:** Require production-grade secrets at startup (fail fast if missing), enforce HTTPS origins for WebAuthn, and document rotation procedures.

### Local file-based storage
- **Issue:** #24
- **Current behavior:** Users and the testnet fee payer secret are stored in `.data/*.json` files on disk.
- **Future work:** Replace file storage with a real database for user records and a secrets manager for `FEE_PAYER_SECRET_KEY`.

### Remaining V1 issues

- ~~Scaffold monorepo with pnpm workspace (issue #5)~~ ✅ Completed
- ~~Implement email + passkey authentication flow (issue #8)~~ ✅ Completed
- ~~Implement smart wallet deployment and receive screen (issue #9)~~ ✅ Completed
- ~~P2P transfers by username, phone, or raw address (issue #10)~~ ✅ Completed
- ~~Implement transaction history and details view (issue #12)~~ ✅ Completed
- ~~Implement PIN confirmation for payments (issue #13)~~ ✅ Completed
- ~~Migrate to self-custodial passkey smart accounts using passkey-kit (issue #33)~~ 🔄 In progress
  - Phase 0 — Validation ✅
  - Phase 1 — Foundation replacement ✅
  - Phase 2 — Auth & onboarding ✅
  - Phase 3 — Balances & receive ✅
  - Phase 4 — Transfers (pending)
  - Phase 5 — Swaps: stub/hide (pending)
  - Phase 6 — Recovery flows (pending)
  - Phase 7 — Cleanup, tests & docs (pending)
  - Phase 8 — Mainnet readiness (pending)
- ~~Implement USDC ↔ XLM swaps via Stellar DEX (issue #11)~~ ⏸️ Stubbed/hidden; see issue #33 Phase 5
- ~~End-to-end testnet testing and documentation update (issue #15)~~ 🔄 Docs updated for passkey-kit migration
