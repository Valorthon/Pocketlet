# Ideas

Last reviewed: 2026-09-17

**This is an unvetted brainstorm, not a roadmap.** Nothing here is scheduled, sized, owned, or committed to. Several entries assume protocol features or ecosystem integrations that may not exist on Stellar today. Treat every item as a conversation starter; committed work lives in [roadmap.md](./roadmap.md).


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

### ~~Link Drops and Smart Escrows~~ — shipped

Built as **claimable links**. Kept here only to record that this idea graduated. See [architecture.md](./architecture.md#claimable-links) and [`contracts/escrow/README.md`](../contracts/escrow/README.md).

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

