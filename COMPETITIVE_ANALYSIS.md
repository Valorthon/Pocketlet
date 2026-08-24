# Competitive Analysis: Blink vs. Pocketlet

## Blink Overview

**Blink** (`useblinkapp.com`) is a recently SCF-funded mobile payment app focused on in-person crypto checkout in emerging markets. It was selected as a **Stellar Community Fund #44 Build Award recipient on the integration track** (announced August 2026).

- **Product:** Bluetooth Low Energy (BLE) tap-to-pay mobile app, with a QR-code fallback.
- **Custody:** Non-custodial embedded wallet. Private keys stay on the user’s device; users can export keys later.
- **Chains/tokens:** USDC on Stellar, Solana, and Base; USDT on Tron.
- **Markets:** Nigeria, Kenya, Ghana, and South Africa first.
- **Value prop:** Consumers spend stablecoins in person; merchants receive local fiat instantly without touching crypto volatility.

Sources:

- Website: https://useblinkapp.com
- Docs: https://useblinkapp.com/doc
- Launch post: https://useblinkapp.substack.com/p/blink-is-live-the-future-of-crypto
- X: https://x.com/useblinkapp
- GitHub org: https://github.com/useblinkapp (no public repositories as of August 2026)

---

## Identified Gap: Closed-Loop vs. Open-Loop Payments

### Blink requires both sides to use Blink

Blink’s payment flow is **closed-loop**:

1. The merchant opens the Blink app, enters the amount, and generates an invoice.
2. The merchant broadcasts a Bluetooth payment request from within Blink.
3. The payer discovers the request inside the Blink app and signs with device biometrics.
4. The transaction settles on-chain, then Blink’s backend swaps crypto to local fiat for the merchant.
5. The merchant can withdraw the fiat balance from Blink to a local bank account.

Key implication: **A payer cannot pay a Blink merchant from an external wallet, exchange, or bank account. The merchant also cannot receive funds directly into a traditional bank or non-Blink wallet at the moment of payment.** Both parties must have the Blink app and a Blink wallet.

From Blink’s docs (emphasis added):

> “On the Blink App, type in the final charge amount… Press **‘Receive’**. Blink will instantly activate a Bluetooth Low-Energy beacon bridging data to **any proximate customer phone** [running Blink].”

> “Once the blockchain states finalize, Blink’s smart bridges swap the incoming crypto for fiat immediately… **You acquire zero volatility exposure.**”

From the launch post:

> “Users can send tokens to other BLINK users instantly using only their BLINK username.”

> “Users and merchants can withdraw directly to their local bank accounts instantly.”

The bank withdrawal is a **secondary cash-out step**, not the primary payment rail. The primary payment requires a Blink wallet on both sides.

---

## Pocketlet’s Opportunity

Pocketlet’s V1 design is already **open-loop** relative to Blink:

| Capability | Blink | Pocketlet V1 |
|---|---|---|
| Payer needs the app | Yes | No — anyone can send USDC/XLM to a Pocketlet Stellar address |
| Merchant needs the app | Yes | No — recipients can be any Stellar address |
| Receive from exchanges / external wallets | Deposit into Blink wallet only | Direct to Soroban smart wallet address |
| Settlement currency | Local fiat, managed by Blink | Crypto-only in V1 (USDC/XLM) |
| Bank withdrawal | Built into Blink app | Deferred to V2 (PHP off-ramp via Anchor/PSP) |
| Custody model | Non-custodial mobile keys | Abstracted passkey + Soroban smart wallet |

### Strategic takeaway

Blink owns the **in-person merchant checkout moment** with a slick closed-loop experience. Pocketlet should not try to beat Blink at Bluetooth POS payments. Instead, Pocketlet’s natural wedge is the **open-loop receipt of international payments**:

- A freelancer, remote worker, or gig worker can share a single Stellar address or QR code.
- Clients, employers, or exchanges send USDC without installing Pocketlet.
- Pocketlet abstracts the blockchain complexity (passkey, no seed phrase, no gas management).

### V2 implication

Pocketlet’s planned V2 Philippines feature — paying a **QR Ph** merchant code and settling PHP to the merchant’s GCash/bank/e-wallet — would widen this gap further. If implemented correctly, the merchant would **not** need a Pocketlet wallet. The user scans any standard QR Ph code, Pocketlet converts USDC/PHPC to PHP off-chain, and the merchant receives fiat in their existing account.

That is a materially different product from Blink:

- **Blink:** Merchant must adopt Blink to get paid.
- **Pocketlet V2:** User pays any QR Ph merchant; merchant friction is minimized.

---

## Risks to Watch

1. **Blink could expand use cases.** SCF funding and multi-chain support may let Blink add P2P usernames, remote invoices, or bank-top-up flows, eroding Pocketlet’s open-loop advantage.
2. **Merchant acquisition is hard.** Blink is solving merchant adoption by making merchants download Blink. Pocketlet’s “merchant-less” QR Ph model depends on Anchor/PSP partnerships and reliable fiat settlement, which is also hard.
3. **Closed-loop UX is smoother.** For in-person payments, requiring both parties to have the same app enables Bluetooth discovery, instant fiat settlement, and predictable UX. Open-loop interoperability often trades smoothness for reach.

---

## Recommendation

Pocketlet should position itself explicitly as the **open-loop global wallet for receiving and spending stablecoins**, not as a competitor to Blink’s closed-loop merchant checkout network. The messaging should highlight:

- Receive from any wallet or exchange — no sender onboarding required.
- Pay any Stellar address or (V2) any QR Ph merchant — no recipient app required.
- Abstracted passkey custody with email recovery — safer for non-crypto users than seed phrases.

This gap is defensible only if V1 ships a clean receive/send experience and V2 lands a reliable PHP off-ramp before Blink expands beyond Africa.
