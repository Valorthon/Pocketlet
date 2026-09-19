# Testing

Last reviewed: 2026-09-17

How to run the suites, and a manual end-to-end checklist for the testnet flows.

## Running the suites

```bash
docker compose up -d              # required — the suite needs a real database
pnpm --filter web test            # Vitest
pnpm run lint
pnpm run typecheck

cd contracts && cargo test        # contract unit tests
```

`apps/web/vitest.setup.ts` applies migrations at module load and clears tables
in `beforeEach`, so without Postgres the suite fails at import rather than with
a useful message.

`DATABASE_URL` is read from `apps/web/.env.local` if your database is not on
the default `localhost:5432` — `apps/web/vitest.env.ts` loads it before the db
module is imported. An exported `DATABASE_URL` still takes precedence:

```bash
DATABASE_URL=postgres://user:pass@localhost:5442/pocketlet pnpm --filter web test
```

## Conventions

Test config lives in `apps/web/vitest.config.ts`; read it rather than trusting a
summary here. Tests are colocated — `foo.ts` alongside `foo.test.ts`. Rust tests
live inline in `contracts/escrow/src/lib.rs` behind `#[cfg(test)]`.

`resetDatabase()` in `src/lib/db/test-setup.ts` deletes rows from `users` and
`metrics` only, so `user_devices`, `claim_links` and `notifications` leak
between tests — clean up explicitly when working in those areas. It uses
`DELETE`, not `TRUNCATE`, so sequences are not reset.

`apps/web/.env.example` is the only home for configuration, kept honest by
`src/lib/env-parity.test.ts`. If you add a `process.env` read, add it there too
or that test fails.

## Coverage

Known gaps and their tracking issues are in
[production-readiness.md](./production-readiness.md). To see what is untested
right now rather than trusting a list that rots:

```bash
# Routes and libs with no adjacent test file
cd apps/web && for f in $(find src -name '*.ts' ! -name '*.test.ts'); do
  [ -f "${f%.ts}.test.ts" ] || echo "$f"
done
```

New work should close the gaps it finds rather than deepen areas already
covered.

## Manual end-to-end checklist (Stellar Testnet)

### Setup

```bash
docker compose up -d
cp apps/web/.env.example apps/web/.env.local
pnpm install
pnpm run dev:web
```

Then, in `apps/web/.env.local`:

- Set `RECOVERY_WAITING_PERIOD_MS=60000` so recovery is testable in a minute rather than a day.
- Set `CLAIM_SECRET_ENCRYPTION_KEY` to `openssl rand -hex 32` — claimable links throw without it.
- Set `NEXT_PUBLIC_ESCROW_CONTRACT_ID` to a deployed escrow address (`pnpm run deploy:contract`) — likewise.

You also need a separate testnet wallet funded with XLM and USDC to act as an external sender ([Stellar Laboratory](https://laboratory.stellar.org/#testnet) works).

Inspect state with `pnpm --filter web db:studio` at any point.

### 1. Sign up

1. Open http://localhost:3000 → **Sign up**, enter an email.
2. The verification code comes back in the API response (a testnet shortcut). Enter it.
3. Register a passkey when prompted.
4. Save the 12-word recovery phrase — recovery testing needs it.
5. `/home` loads and shows the balance card.

**Expect:** a `users` row with `email_verified = true`, `credential` populated, and `recovery_public_key` set.

### 2. Deploy the smart wallet

From `/home` → **Receive**. The app calls `POST /api/wallet/deploy`.

**Expect:** a `contractId` in the response, and `wallet_contract_id` set on the user row. The fee payer funds itself via Friendbot if needed.

### 3. Receive USDC and XLM

1. Copy the address from `/home` or `/receive`.
2. Send ~5 XLM from the external wallet.
3. Send ~5 USDC using the Circle testnet SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.
4. Balances auto-refresh every 15s, or tap **Refresh**.

**Expect:** both balances increase; `/transactions` shows `receive` entries; `/transactions/[hash]` shows the fee and on-chain hash.

### 4. Set a PIN

`/home` → **Set up PIN** in the Security card → enter and confirm 6 digits. The badge changes to **PIN set**.

### 5. Send to a Stellar address

From `/home` → **Send**, with a raw testnet address, amount `0.5`, asset USDC or XLM. Review the resolved address and simulated fee, confirm with the PIN.

**Expect:** a transaction hash; the recipient's balance rises; `/transactions` shows a `send`.

### 6. P2P to another Pocketlet user

1. Create a second user in a private window; deploy their wallet.
2. On the second user, set a username and phone in **Profile**.
3. From the first user, send to `@username` or `+phone`.

**Expect:** the recipient resolves to a Stellar address before submission, and the transfer completes.

### 7. Claimable link to an unregistered recipient

1. From **Send**, enter a phone number or email that belongs to no account.
2. Confirm — the app creates an escrow deposit and returns a claim link.
3. Check the `claim_links` row: `status = pending`, `secret_ciphertext` populated, `claim_hash` set.
4. Open the link in a private window, sign up, and claim.

**Expect:** funds move from escrow to the new user's wallet; `status` becomes claimed; `claimed_at` is set. Refunding before expiry must fail — the contract rejects it.

### 8. Device-key login

Log out and back in on the same device. A `user_devices` row should exist with a future `expires_at`, and subsequent sends should need only the PIN, not a biometric prompt.

### 9. Passkey recovery

1. Open `/recover`, enter the email, submit.
2. The recovery code is returned in the response. Enter it.
3. Wait out `RECOVERY_WAITING_PERIOD_MS` (60s if set above).
4. Enter the 12-word phrase and register a new passkey.
5. Log in with the new passkey.

**Expect:** the phrase signs a transaction adding the new passkey as a signer and removing the lost one. The phrase stays valid as a backup.

### 10. Transaction details

`/transactions` → open any entry. Verify type, amount, counterparty, network fee, and the on-chain hash linking to Stellar Expert.

### 11. Swaps

Expected to be inert — see the [feature table](../README.md#features).

### Troubleshooting

**Passkey registration fails.** Use `http://localhost:3000` exactly, or HTTPS with a matching `WEBAUTHN_RP_ID` — passkeys are origin-bound and will not work over plain HTTP on a non-localhost origin.

**Claim links throw.** See [operations.md](./operations.md#common-production-problems); the cause is the same locally.

**Wallet deployment fails.** Check that `NEXT_PUBLIC_WALLET_WASM_HASH` is installed on testnet, that the RPC URL is reachable, and that Friendbot can fund the fee payer.

**Balance doesn't update.** Tap Refresh or wait 15s. Confirm `wallet_contract_id` is set on the user row and that Soroban RPC is reachable.

**Recovery is locked.** Three failed attempts lock the account for an hour. Clear it in the database:

```sql
UPDATE users SET recovery_locked_until = NULL, recovery_attempts = 0
WHERE email = 'you@example.com';
```

**Start completely fresh.** Drop and recreate the database — migrations reapply on the next boot:

```bash
docker compose down -v && docker compose up -d
```

Also delete the testnet fee payer if you want a new one: `rm apps/web/.data/fee_payer_secret`.

> Testnet is reset periodically. If balances or deployed wallets vanish, that's usually why.
