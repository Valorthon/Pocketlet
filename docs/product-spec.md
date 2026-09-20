# Product Spec — V1

Last reviewed: 2026-09-20

What Pocketlet V1 is for and what it does. Implementation detail lives in [architecture.md](./architecture.md); current feature status lives in the [README table](../README.md#features); deferred work lives in [roadmap.md](./roadmap.md).

## 1. Product Overview
Pocketlet is a web-based wallet designed for anyone who earns and moves money across borders. It looks and acts like a familiar money app, but uses the Stellar blockchain as its settlement layer. The wallet abstracts the complexities of crypto (gas fees, complex addresses, key management) while allowing users to hold and move stable digital dollars globally.

### Core Value Proposition
* **Invisible Crypto:** Users hold and spend USD (via USDC) without realizing they are interacting with a blockchain.
* **Abstracted Self-Custody:** Users sign up with email and authenticate with a passkey. A Soroban smart contract wallet is deployed on their behalf. A BIP39 recovery phrase is generated client-side for backup recovery.
* **Global Payments, Simple Feel:** Users can receive international payments in USDC and move stable value globally without managing crypto complexity.

---

## 2. Target Audience (V1)
* **Demographic:** Freelancers, gig workers, and early-adopters globally who receive international payments and want a simple way to hold and move stable digital dollars.
* **Pain Point:** High remittance fees, slow settlement, and the friction of managing crypto wallets, keys, and gas fees.

---

## 3. Core Features (V1 MVP)

### 3.1. Account Creation & Custody (Soroban Powered)
* **Default:** Abstracted Self-Custody. Users sign up with an email and authenticate with a passkey. A Soroban smart contract wallet is deployed on their behalf.
* **Smart Wallet:** One lightweight passkey-kit smart wallet per user. The passkey acts as the primary signer.
* **Recovery Phrase:** A BIP39 recovery phrase (Stellar derivation path `m/44'/148'/0'`) is generated client-side during onboarding and is never sent to the server.
* **Backup Passkey:** Users may register an optional backup passkey.
* **Fee Sponsorship:** The platform covers standard Stellar network fees on behalf of the user via a server-held fee payer, so users never need to hold XLM to move USDC. Fees are currently **absorbed**, not recovered — see [architecture.md](./architecture.md#why-there-is-a-fee-payer). A user-pays model is an open decision in [roadmap.md](./roadmap.md#open-product-decisions).
* **Self-Custody Export UI:** A dedicated seed-phrase export view is deferred to V2.

### 3.2. Deposits (V1)
* **No Fiat On-Ramp in V1:** Direct fiat-to-stablecoin on-ramps via Stellar Anchors are deferred to later versions. V2 will focus on Philippine Peso (PHP) rails.
* **External Deposit:** Users receive USDC or XLM by sharing their Stellar address or a generated QR code. Funds are received directly into their smart wallet.

### 3.3. Peer-to-Peer (P2P) Transfers
* **Send to Pocketlet Users:** Users can send USDC or XLM to other Pocketlet users by username or phone number. The app resolves the recipient internally.
* **Send to Non-Users:** If the recipient is not a Pocketlet user, the sender can paste a raw Stellar address.
* **Confirmation:** All sends require PIN confirmation.

### 3.4. Claimable Links (Send to Non-Users)
* **What:** If the recipient has no Pocketlet account, the sender can still send. Funds go into a Soroban escrow contract against a hashed secret, and the app returns a claim link.
* **Claiming:** The recipient opens the link, creates an account and wallet, and submits the secret to release the funds.
* **Refund:** If nobody claims before expiry, the sender can refund the deposit.
* **Privacy:** The contract only ever sees hashes — never the secret, never a phone number or email.
* **Note:** Notification delivery is not yet implemented; the sender shares the link manually today.

### 3.5. Device-Key Login
* **What:** After the first passkey login, a short-lived Ed25519 device signer is registered so routine sends need only a PIN rather than a biometric prompt each time.
* **Scope:** Device keys expire and are recorded per device; they never replace the passkey as the wallet's primary signer.

### 3.6. Admin Dashboard
* **What:** A token-gated `/admin` view showing operational counters (wallet deployments, transfers, claim links).
* **Access:** Requires `ADMIN_SECRET_TOKEN`. It is an internal operations tool, not a user-facing feature.

### 3.7. Crypto Swaps (Deferred)
* **Status:** USDC ↔ XLM swaps are temporarily disabled in the passkey-kit migration and deferred to a future version.
* **Planned behavior:** Users will be able to swap between **USDC** and **XLM** utilizing Stellar's native Decentralized Exchange (DEX), with expected output, price impact, and total fees shown before confirmation.
* **Confirmation:** All swaps will require PIN confirmation.

### 3.8. Transaction Details
* Users have a dedicated "Transaction Details" view where they can see the exact network fee breakdown, swap details (when swaps are enabled), and on-chain hash for transparency.

---

## 4. Regulatory & Compliance (V1)
* **Technology Interface:** Pocketlet V1 operates purely as a technology interface. It does not custody user funds in a regulated e-money capacity, does not perform KYC, and does not process fiat.
* **User-Funded Wallets:** Users control their own Soroban smart wallets. The platform never holds pooled user funds.
* **Fiat On/Off-Ramp Delegation:** All fiat on-ramp, off-ramp, KYC, and settlement will be handled by licensed Stellar Anchors or payment service providers in V2.
* **Data Privacy:** User email and phone data is stored in accordance with applicable data privacy regulations. No government IDs are collected in V1.

---

## 5. Custody Model
* **Default Model:** Abstracted self-custody via a passkey-kit Soroban smart wallet controlled by a WebAuthn/Passkey signer. The platform never holds user signing keys.
* **One Wallet Per User:** Each user gets their own smart contract wallet deployment for isolation and simplicity.
* **Recovery:** Users receive a BIP39 recovery phrase (Stellar derivation path `m/44'/148'/0'`) during onboarding and may register an optional backup passkey. If the primary passkey is lost, recovery can be performed with the seed phrase or backup passkey. The recovery phrase never touches the server.
* **Full Self-Custody UI:** A dedicated seed-phrase export view and external-key import are deferred to V2.

---

## 6. Fee Structure
* **Platform-Absorbed Model (current):** The server-held fee payer pays Stellar network fees for transfers and contract invocations. There is no cost recovery and no platform markup anywhere in the implementation. Users never need XLM to move USDC.
* **Fee Display:** The estimated network fee is shown on the confirmation screen before the user approves a payment, and the exact fee is visible afterwards in Transaction Details.
* **Not yet decided:** whether V2 moves to a user-pays model with fees baked into the transaction, and whether any platform markup is applied. Tracked in [roadmap.md](./roadmap.md#open-product-decisions).
* **Deferred:** DEX swap spread and slippage (swaps are disabled), and Anchor on-ramp/off-ramp fees (V2).

---

## 7. Security & Recovery
* **PIN Confirmation:** A PIN is required to confirm all payments.
* **Passkey Authentication:** Login and sensitive actions are secured via device-bound or synced passkeys.
* **Email Verification:** Email verification is required for account creation and recovery flows.
* **Lost Passkey Recovery:** Users can recover with their BIP39 recovery phrase or an optional backup passkey. Email verification may still be used as a recovery channel where configured.
* **Unrecoverable State:** If a user loses their passkey, backup passkey, and recovery phrase, the account cannot be recovered.
* **Privacy:** Users can only view their own transaction history and balances.

---

## 8. Technical Architecture (V1 Web App)

### Frontend
* **Framework:** Next.js 15 with App Router, mobile-optimized layout.
* **Language:** TypeScript only. No `any` or `@ts-ignore`.
* **Styling:** Tailwind CSS.
* **State Management:** UI state in React hooks/props or server-derived state; global client store only when multiple pages need shared, client-only data.

### Blockchain Layer (Stellar / Soroban)
* **Network:** Stellar Testnet for V1.
* **Assets:**
    * `USDC` (Issued by Circle)
    * `XLM` (Native asset, for fees)
* **Smart Accounts (Soroban):**
    * *Passkey-kit Smart Wallet:* Self-custodial passkey-controlled wallet supporting SAC token transfers. DEX swaps are deferred.

### Integration Standards (SEPs)
* **SEP-2 (Federation):** Evaluated for P2P addressing. V1 uses an internal username/phone mapping. SEP-2 may be adopted in a future version if the user base grows and public addressing is needed.

### Data Layer
* **PostgreSQL** via Drizzle ORM holds accounts, device keys, claim links, notification records, and operational counters. Migrations are applied at boot. Schema detail in `apps/web/src/lib/db/schema.ts`.
* **No user key material is persisted.** Passkey private keys never leave the device, and the BIP39 recovery phrase is generated client-side — the server stores only the derived public key.
* **Custom contract:** the claimable-link escrow contract in `contracts/escrow` ([interface](../contracts/escrow/README.md)).

### External APIs
* **Horizon:** For account state and transaction history.
* **Soroban RPC:** For smart contract simulation and submission.

---

## 9. User Journey Flow (Receiving a Freelance Payment in USDC)

1. User opens the Web App and signs up with email and passkey.
2. A Soroban smart wallet is deployed on their behalf.
3. The user shares their Stellar address or QR code with a client abroad.
4. The client sends USDC to the user's wallet address.
5. The user sees "Received 100 USDC" in their activity feed.
6. The user taps the transaction to see the on-chain hash and network fee details.

---

## 10. Future Versions

V2 focuses on the Philippines market (PHP stablecoin, fiat rails, QR Ph). V3 expands the product to support multiple stablecoins and additional regional markets.

Which features belong to V1+, V2, and V3 — and why each was deferred — is in [roadmap.md](./roadmap.md). It is the only copy of that list.

---

## 11. Open Questions / Notes
* V1 remains on Stellar Testnet. Mainnet deployment is out of scope for the current roadmap; the blockers are listed in [production-readiness.md](./production-readiness.md).
* Passkey credential behaviour (device-bound vs. synced via Apple/Google) depends on the user's device and platform. Whether to constrain this is an open policy question.
* Whether V2 adopts a user-pays fee model — see [roadmap.md](./roadmap.md#open-product-decisions).

*Resolved:* the recovery waiting period is 24 hours (`RECOVERY_WAITING_PERIOD_MS`, configurable). DEX swaps are deferred rather than pending — see the [feature table](../README.md#features).
