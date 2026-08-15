import { PasskeyKit, SACClient } from 'passkey-kit';
import { IndexedDBStorage } from 'passkey-kit/storage';
import { Asset } from '@stellar/stellar-sdk';
import { Client as SacClient } from 'sac-sdk';
import { RPC_URL, NETWORK_PASSPHRASE } from './network';
import { getUsdcContractId } from './assets';

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
export const RP_ID = process.env.NEXT_PUBLIC_PASSKEY_RP_ID ?? process.env.WEBAUTHN_RP_ID;

/**
 * Create a browser-side PasskeyKit client for the current network.
 *
 * The kit handles WebAuthn ceremonies, deterministic wallet-address
 * derivation, and signing. It holds no secrets.
 */
export function createPasskeyKit(): PasskeyKit {
  return new PasskeyKit({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    walletWasmHash: WALLET_WASM_HASH,
    rpId: RP_ID,
    storage: new IndexedDBStorage(),
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
 * Create a SEP-41 token client for a specific wallet source.
 *
 * The returned client uses the smart-wallet contract as the transaction source
 * so that `transfer(...)` auth entries are authorized by the wallet signer.
 */
export function createTokenClient(tokenContractId: string, walletContractId: string): SacClient {
  return new SacClient({
    contractId: tokenContractId,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: walletContractId,
  });
}
