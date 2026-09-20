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
import { RPC_URL, NETWORK_PASSPHRASE } from './network';
import { getUsdcContractId } from './assets';

export { SignerStore, PasskeyClient, SignerKey, Ed25519Signer };

/**
 * Canonical v1 passkey-kit smart-wallet WASM hash.
 * Injected via env so the same build can target testnet or mainnet.
 */
export const WALLET_WASM_HASH =
  process.env.NEXT_PUBLIC_WALLET_WASM_HASH ??
  'fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0';

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
    rpId: RP_ID,
    storage: new IndexedDBStorage(),
    timeoutInSeconds: 300,
    ...(challenge ? { WebAuthn: serverChallengeWebAuthn(challenge) } : {}),
  });
}

/**
 * Connect a PasskeyKit instance to a known smart-wallet contract address
 * without performing a WebAuthn ceremony.
 *
 * This is used during lost-passkey recovery: the user has no accessible
 * passkey, but can sign admin transactions with their BIP39-derived Ed25519
 * recovery key via `Ed25519Signer`.
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
 * wallet auth entries. Sign it with `await kit.sign(tx)` before submitting.
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
