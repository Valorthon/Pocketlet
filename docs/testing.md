# Testing

Last reviewed: 2026-09-17

Two things live here: how the automated suites are laid out, and a manual end-to-end checklist for the testnet flows.

## Running the suites

```bash
docker compose up -d              # required — see below
pnpm --filter web test            # Vitest
pnpm run lint
pnpm run typecheck

cd contracts && cargo test        # 12 contract unit tests
```

**The TypeScript suite requires a live Postgres.** `apps/web/vitest.setup.ts` runs `migrate()` at module load and calls `resetDatabase()` in `beforeEach`. Without a database the suite fails at import, not with a helpful message.

> **`DATABASE_URL` in `.env.local` is ignored by the test suite.** `vitest.setup.ts` imports `./src/lib/db` before it calls `config({ path: '.env.local' })`, and that module creates the `pg` Pool at module scope. The connection string is therefore already resolved — from the real environment, or from the hardcoded `postgres://pocketlet:pocketlet@localhost:5432/pocketlet` fallback — before dotenv ever runs. If your database is not on `localhost:5432` with those credentials, export it instead:
>
> ```bash
> DATABASE_URL=postgres://user:pass@localhost:55432/pocketlet pnpm --filter web test
> ```
>
> The failure mode is a confusing `password authentication failed`, because the suite quietly connected to whatever else is on port 5432.

## Layout and conventions

- Vitest, `environment: 'node'`, `globals: true`, `pool: 'forks'`, `maxWorkers: 1`. The `@` alias maps to `src`.
- Tests are colocated: `foo.ts` → `foo.test.ts`.
- 246 cases across 34 files; 16 use `vi.mock`.
- Rust tests live inline in `contracts/escrow/src/lib.rs` behind `#[cfg(test)]`.

Test data does not fully reset between cases — `resetDatabase()` truncates only `users` and `metrics`, so `user_devices`, `claim_links`, and `notifications` leak. Clean up explicitly in those areas. See [database.md](./database.md).

## Known gaps

Worth knowing before you claim something is covered:

- **No component or page tests at all.** `@vitejs/plugin-react` and `fake-indexeddb` are installed, but nothing renders a component. There is no React Testing Library.
- **All five `api/wallet/claim-links/*` routes are untested** — the newest and most intricate feature.
- Untested routes: most of `api/auth/*` (`challenge`, `email-challenge`, `login-options`, `login-verify`, `device-login`, `login-seedphrase`, `register-device`, `logout`, `pin*`), `api/admin/stats`, `api/wallet/device-key/submit`, `api/wallet/transactions/detail`.
- Untested libs: `admin.ts`, `notifications.ts`, `auth/session.ts`, and `wallet/{assets,network,token,recipient,device-key,claim-secrets,claim-link-client}.ts`.
- No coverage tooling is configured — no `--coverage` script, no thresholds.
- Contract tests use bare `#[should_panic]` with no `expected =` string, so a test can pass on the *wrong* panic. Add the string when you touch one.

New work should close these gaps rather than add depth where coverage already exists.

---

# Manual end-to-end checklist (Stellar Testnet)

## Setup

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

> Addressing by **email** will not resolve, even for a registered user — it falls through to the claimable-link path. That's a known issue, not a test failure.

### 7. Claimable link to an unregistered recipient

1. From **Send**, enter a phone number or email that belongs to no account.
2. Confirm — the app creates an escrow deposit and returns a claim link.
3. Check the `claim_links` row: `status = pending`, `secret_ciphertext` populated, `claim_hash` set.
4. Open the link in a private window, sign up, and claim.

**Expect:** funds move from escrow to the new user's wallet; `status` becomes claimed; `claimed_at` is set. Refunding before expiry must fail — the contract rejects it.

> No notification is actually delivered. `notifications` rows are written with `status: 'sent'` while `src/lib/notifications.ts` only logs.

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

`/swap` shows a placeholder and the API returns HTTP 410. This is expected — see the [feature table](../README.md#features).

## Troubleshooting

**Passkey registration fails.** Use `http://localhost:3000` exactly, or HTTPS with a matching `WEBAUTHN_RP_ID`. Passkeys don't work over plain HTTP on non-localhost origins.

**Wallet deployment fails.** Check that `NEXT_PUBLIC_WALLET_WASM_HASH` is installed on testnet, that the RPC URL is reachable, and that Friendbot can fund the fee payer.

**Balance doesn't update.** Tap Refresh or wait 15s. Confirm `wallet_contract_id` is set on the user row and that Soroban RPC is reachable.

**Recovery is locked.** Three failed attempts lock the account for an hour. Clear it in the database:

```sql
UPDATE users SET recovery_locked_until = NULL, recovery_attempts = 0
WHERE email = 'you@example.com';
```

**Claim link throws immediately.** `CLAIM_SECRET_ENCRYPTION_KEY` or `NEXT_PUBLIC_ESCROW_CONTRACT_ID` is unset. Both throw rather than degrading.

**Start completely fresh.** Drop and recreate the database — migrations reapply on the next boot:

```bash
docker compose down -v && docker compose up -d
```

Also delete the testnet fee payer if you want a new one: `rm apps/web/.data/fee_payer_secret`.

> Testnet is reset periodically. If balances or deployed wallets vanish, that's usually why.
