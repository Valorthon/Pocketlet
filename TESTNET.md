# End-to-End Testnet Testing Guide

This guide covers the V1 Pocketlet flows on Stellar Testnet. It assumes the app is running locally against `http://localhost:3000` and the environment is configured for testnet (see [`README.md`](./README.md)).

## Prerequisites

1. Install dependencies:

```bash
pnpm install
```

2. Start the web app:

```bash
pnpm run dev:web
```

3. For quick recovery testing, create `apps/web/.env.local` with:

```bash
RECOVERY_WAITING_PERIOD_MS=60000
```

4. Have a separate testnet wallet funded with XLM (and ideally USDC) to act as an external sender. You can use the [Stellar Laboratory](https://laboratory.stellar.org/#testnet) or a testnet wallet app.

## Test Checklist

### 1. Sign Up with Email and Passkey

1. Open `http://localhost:3000` and click **Sign up**.
2. Enter a valid email address and submit.
3. The app returns the verification code in the response (testnet shortcut). Enter it.
4. Register a passkey when prompted (browser/device biometrics).
5. Verify the `/home` page loads and shows the wallet balance card.

**Expected:** A user is created with `emailVerified=true`, `credential` set, and the smart wallet can be deployed.

### 2. Deploy the Smart Wallet

1. From `/home`, click **Receive**.
2. The app calls `POST /api/wallet/deploy` and deploys the smart wallet.
3. Note the Stellar address shown in the **Your Stellar address** section.

**Expected:** The `/api/wallet/deploy` response returns a contract address (`contractId`). The fee payer account is funded automatically on testnet when needed.

### 3. Receive USDC and XLM from an External Testnet Wallet

1. Copy your wallet's Stellar address from `/home` or the **Receive** page.
2. From an external testnet wallet, send a small amount of XLM (e.g., 5 XLM) to the address.
3. Send a small amount of USDC (e.g., 5 USDC) to the same address using the Circle testnet USDC contract `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.
4. Return to `/home`. The balance card auto-refreshes every 15 seconds; tap the **Refresh** button next to the balance to update immediately.

**Expected:**

- XLM balance increases by the sent amount.
- USDC balance increases by the sent amount.
- `/transactions` shows the incoming payments with type `receive`.
- `/transactions/[hash]` shows the transaction details, including network fee and on-chain hash.

### 4. Set a PIN

1. From `/home`, click **Set up PIN** in the Security card.
2. Enter a 6-digit PIN and confirm.
3. Verify the security badge changes to **PIN set**.

### 5. Send USDC/XLM to a Stellar Address

1. From `/home`, click **Send**.
2. Enter a recipient. You can use:
   - A Pocketlet username, e.g. `@alice`
   - A Pocketlet phone number, e.g. `+63 912 345 6789`
   - Any external testnet Stellar address (e.g., from another wallet or the Stellar Laboratory).
3. Enter an amount (e.g., `0.5`).
4. Select the asset (USDC or XLM).
5. Review the resolved Stellar address on the confirmation screen.
6. Confirm with the PIN.
7. Submit and wait for the transaction hash.

**Expected:**

- The recipient is resolved to a Stellar address before the transfer is submitted.
- The wallet contract's `transfer` function is invoked.
- The recipient's balance increases.
- `/transactions` shows an outgoing `send` transaction.

### 6. P2P Transfer to Another Pocketlet User

1. Create a second user by signing up with a different email in an incognito/private window (or another browser).
2. Deploy the wallet for the second user.
3. On the second user, go to **Profile** from `/home` and set a username (e.g., `alice`) and/or phone number (e.g., `+63 912 345 6789`).
4. From the first user's `/send` page, enter the second user's `@username` or `+phone` number.
5. Review the resolved Stellar address and enter an amount.
6. Confirm with PIN.

**Expected:** The transfer completes and the second user's balance increases.

### 7. Swaps (Disabled)

USDC ↔ XLM swaps are temporarily disabled in this passkey-kit migration. The `/swap` page shows a "coming soon" message. Swaps will be reintroduced in a future version using a real Stellar DEX/AMM integration.

### 7. Test Passkey Recovery

1. Log in with a user that has a wallet and PIN.
2. Open `/recover`.
3. Enter the user's email and submit.
4. The recovery code is returned in the response (testnet shortcut). Enter it.
5. Wait for the configured waiting period (1 minute if `RECOVERY_WAITING_PERIOD_MS=60000`).
6. Register a new passkey when prompted.
7. Log in with the new passkey.

**Expected:**

- The recovery admin rotates the smart wallet owner on-chain.
- The old passkey no longer works.
- The new passkey works for login.

### 8. Verify Transaction Details

1. Go to `/transactions`.
2. Click any transaction.
3. Verify the details page shows:
   - Transaction type and amount
   - Recipient/sender (for payments)
   - Sell/buy assets (for swaps)
   - Network fee
   - On-chain hash with a link to Stellar Expert

## Verification Commands

After running the end-to-end flow, confirm the local test suite still passes:

```bash
pnpm --filter web test
pnpm run lint
pnpm run typecheck
```

## Troubleshooting

### Passkey registration fails

- Ensure you are using `http://localhost:3000` (or HTTPS with a valid `WEBAUTHN_RP_ID`).
- Passkeys do not work over plain HTTP on non-localhost origins.

### Wallet deployment fails

- Verify `NEXT_PUBLIC_WALLET_WASM_HASH` is set to a WASM hash installed on testnet.
- Verify the testnet Friendbot is accessible from the RPC URL.
- Check that the fee payer account can be funded by Friendbot.

### Balance does not update

- Tap the **Refresh** button on the home balance card, or wait for the 15-second auto-poll.
- Verify the user's `contractId` is stored in `apps/web/.data/users.json`.
- Check that the Soroban RPC URL is reachable.

### Recovery is locked

- After 3 failed recovery attempts, the account is locked for 1 hour.
- Clear `recoveryLockedUntil` in `apps/web/.data/users.json` for testing.

## Notes

- Testnet accounts are occasionally reset. If balances or deployments disappear, delete `apps/web/.data/users.json` and `apps/web/.data/fee_payer_secret` to start fresh.
- Swaps are temporarily disabled while the DEX integration is rebuilt for the passkey-kit wallet.
- Email verification returns the code in the API response for testnet convenience. Do not use this behavior in production.
