import {
  PasskeyKit,
  SACClient,
  SignerStore,
  PasskeyClient,
  SignerKey,
  Ed25519Signer,
} from 'passkey-kit';
import { IndexedDBStorage } from 'passkey-kit/storage';
import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser';
import { Asset } from '@stellar/stellar-sdk';
import { type AssembledTransaction } from '@stellar/stellar-sdk/contract';
import { RPC_URL, NETWORK_PASSPHRASE, HORIZON_URL } from './network';
import { getUsdcContractId } from './assets';

export { SignerStore, PasskeyClient, SignerKey, Ed25519Signer };

/**
 * Canonical v1 passkey-kit smart-wallet WASM hash.
 * Injected via env so the same build can target testnet or mainnet.
 *
 * The value is upstream's canonical build, published in passkey-kit's own
 * `README.md` and `SECURITY.md` and in its deployment manifest
 * `docs/deployments-2026-09-01.md`; it is installed on testnet (upload tx
 * `a910da98…`, ledger 4454440) and on mainnet (`441f3987…`, ledger 64229392).
 * Do not edit it from memory: the 0.19 `PasskeyKit` constructor rejects the
 * known-vulnerable legacy hashes outright, and `connectWallet` rejects any
 * wallet whose code is not in `acceptedWasmHashes` (which defaults to this
 * one), so a wrong value fails on chain rather than quietly.
 */
export const WALLET_WASM_HASH =
  process.env.NEXT_PUBLIC_WALLET_WASM_HASH ??
  '97ce047884106b1c6c3bb40b8973cc48db1c4dad95c9e20462bf2c701daa764e';

/**
 * WebAuthn relying party ID used by passkey-kit.
 * Defaults to the existing WebAuthn config, or the browser origin if unset.
 */
export const RP_ID =
  process.env.NEXT_PUBLIC_PASSKEY_RP_ID?.trim() ||
  process.env.WEBAUTHN_RP_ID?.trim() ||
  undefined;

/**
 * Fetch a single-use registration challenge from the server.
 *
 * Needed because passkey-kit generates its own random challenge and exposes
 * no way to supply one — see `serverChallengeWebAuthn`. Requires a session or
 * a recovery cookie.
 */
export async function fetchPasskeyChallenge(): Promise<string> {
  const res = await fetch('/api/wallet/passkey-challenge', { method: 'POST' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Could not start the passkey ceremony');
  }
  const body = (await res.json()) as { challenge: string };
  return body.challenge;
}

/**
 * Wrap the WebAuthn ceremony so registration uses a server-issued challenge.
 *
 * `createWallet` and `createKey` call `generateChallenge()` internally and
 * `CreateOptions` has no challenge field, so the only way to bind the ceremony
 * to a server nonce is through the kit's `WebAuthn` injection point — intended
 * for tests, but it is the documented seam and the alternative is
 * reimplementing the ceremony. We overwrite the challenge on the way through
 * and otherwise delegate to the real @simplewebauthn/browser (issue #56).
 *
 * Authentication is passed through untouched: passkey-kit sets that challenge
 * to the transaction payload, and the smart wallet verifies that binding
 * on-chain.
 */
function serverChallengeWebAuthn(challenge: string) {
  return {
    startRegistration: (args: Parameters<typeof startRegistration>[0]) =>
      startRegistration({
        ...args,
        optionsJSON: { ...args.optionsJSON, challenge },
      }),
    startAuthentication,
  };
}

/**
 * Create a browser-side PasskeyKit client for the current network.
 *
 * The kit handles WebAuthn ceremonies, deterministic wallet-address
 * derivation, and signing. It holds no secrets.
 *
 * Pass `challenge` (from {@link fetchPasskeyChallenge}) whenever the kit will
 * register a passkey — `createWallet` or `createKey`. The server requires it:
 * without it the registration response is rejected.
 */
export function createPasskeyKit(challenge?: string): PasskeyKit {
  return new PasskeyKit({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    walletWasmHash: WALLET_WASM_HASH,
    // Full-history source for wallet-birth verification. The kit would pick
    // the official endpoint for the two well-known passphrases on its own,
    // but Pocketlet already configures Horizon explicitly
    // (NEXT_PUBLIC_STELLAR_HORIZON_URL) and a custom/standalone network gets
    // no default at all — without it `confirmWalletCreation` and
    // `connectWallet` can only see creation transactions still inside RPC
    // retention.
    horizonUrl: HORIZON_URL,
    // `acceptedWasmHashes` and `acceptedBirthWasmHashes` are deliberately left
    // at their default, `[walletWasmHash]`: Pocketlet deploys exactly one
    // build and has never run a wallet upgrade, so widening either list would
    // accept code this app has never shipped. Add an entry only as part of a
    // real upgrade.
    rpId: RP_ID,
    storage: new IndexedDBStorage(),
    timeoutInSeconds: 300,
    ...(challenge ? { WebAuthn: serverChallengeWebAuthn(challenge) } : {}),
  });
}

/**
 * OPEN PRODUCT DECISION (issue #118 follow-up): fresh-device wallet discovery.
 *
 * passkey-kit 0.19 removed `ConnectOptions.getContractId` and
 * `ConnectOptions.verifyWasmHash`. `connectWallet({ keyId })` still typechecks,
 * but it no longer *derives* the wallet address from the credential id. It now
 * resolves candidates from exactly two places:
 *
 *   1. a verified record in the kit's own `StorageAdapter` (our
 *      `IndexedDBStorage`), written by `confirmWalletCreation` at signup and by
 *      `addSecp256r1` when a backup passkey is added; or
 *   2. `ConnectOptions.getWalletCandidates`, a complete indexer response
 *      (`schema: 2`, `complete: true`, `indexedThroughLedger` at or past the
 *      current ledger) carrying each candidate's immutable birth claims —
 *      `birthWasmHash`, `creationTransactionHash`, `creationLedger` — which the
 *      kit re-verifies against the creating transaction.
 *
 * Pocketlet passes only `{ keyId }`, so today a login works on the device that
 * ran signup and fails with `WALLET_NOT_FOUND` on a fresh browser profile, a
 * second device, or after site data is cleared — even though the passkey
 * itself syncs. That is a behaviour regression from 0.16, and closing it is a
 * product decision this change deliberately does not make:
 *
 *   (a) Wire `getWalletCandidates` to the kit's keyless `MercuryIndexer`
 *       (`MercuryIndexer.forNetwork({ rpc }, NETWORK_PASSPHRASE)` →
 *       `findWallets(SignerKey.Secp256r1(keyId))`). No secret, hosted, covers
 *       testnet and mainnet — but it puts a third party in the login path.
 *   (b) Serve the lookup ourselves. `users` already holds
 *       `wallet_contract_id`; it would additionally need the creating
 *       transaction hash, its ledger, and the birth WASM hash (a schema change
 *       plus a route), and we would be asserting `complete: true` about a table
 *       that is not an indexer.
 *   (c) Accept same-device-only login and tell the user to recover instead.
 *
 * Whoever picks one must also re-run steps 8 and 9 of the manual checklist in
 * docs/testing.md. Until then, do not paper over it by widening
 * `acceptedBirthWasmHashes` or by re-deriving an address by hand — both defeat
 * the birth verification the 0.19 line exists to add.
 */

/**
 * Connect a PasskeyKit instance to a known smart-wallet contract address
 * without performing a WebAuthn ceremony.
 *
 * This is used during lost-passkey recovery: the user has no accessible
 * passkey, but can sign admin transactions with their BIP39-derived Ed25519
 * recovery key via `Ed25519Signer`.
 *
 * It sets `kit.wallet` and leaves `kit.keyId` undefined on purpose — there is
 * no connected passkey. On passkey-kit 0.19 that matters: `kit.addSecp256r1`
 * reads the connected passkey's stored birth record and throws
 * `WalletOwnershipError('The connected wallet has no verified birth record')`
 * when there is none, so the `/recover` path needs testnet verification before
 * it can be called working. See the checklist in the issue #118 PR.
 */
export function connectPasskeyKitByContractId(
  kit: PasskeyKit,
  contractId: string
): void {
  kit.wallet = new PasskeyClient({
    contractId,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
}

/**
 * Create a SACClient for reading SEP-41 token balances and building transfers.
 */
export function createSACClient(): SACClient {
  return new SACClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
}

/**
 * SAC client for the configured USDC contract.
 */
export function getUsdcSACClient() {
  const sac = createSACClient();
  return sac.getSACClient(getUsdcContractId());
}

/**
 * SAC client for the native XLM asset contract.
 */
export function getXlmSACClient() {
  const sac = createSACClient();
  return sac.getSACClient(Asset.native().contractId(NETWORK_PASSPHRASE));
}

/**
 * Build an unsigned SEP-41 token transfer from the connected smart wallet.
 *
 * The returned AssembledTransaction has been simulated and contains unsigned
 * wallet auth entries. Sign it with `await kit.sign(tx)` before submitting —
 * this is an ordinary token transfer, not a wallet-admin write, so the
 * generic `sign()` path (which refuses wallet re-entry) is the correct one.
 */
export async function prepareTokenTransferTx(
  kit: PasskeyKit,
  tokenContractId: string,
  to: string,
  amount: bigint
): Promise<AssembledTransaction<null>> {
  if (!kit.contractId) {
    throw new Error('Wallet not connected');
  }

  const sac = createSACClient();
  const token = sac.getSACClient(tokenContractId);

  return token.transfer({
    from: kit.contractId,
    to,
    amount,
  });
}

/**
 * Build and sign a SEP-41 token transfer from the connected smart wallet.
 */
export async function buildTokenTransferTx(
  kit: PasskeyKit,
  tokenContractId: string,
  to: string,
  amount: bigint
): Promise<AssembledTransaction<null>> {
  const tx = await prepareTokenTransferTx(kit, tokenContractId, to, amount);
  await kit.sign(tx);
  return tx;
}
