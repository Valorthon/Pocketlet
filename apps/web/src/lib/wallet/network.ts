import { Networks } from '@stellar/stellar-sdk';

export const RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
export const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

/**
 * Returns true when the configured Stellar network is the public/mainnet network.
 */
export function isProductionNetwork(): boolean {
  return NETWORK_PASSPHRASE === Networks.PUBLIC;
}
