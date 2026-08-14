import { Asset } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE } from './network';

/**
 * Circle's official testnet USDC asset:
 *   USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
 * Source: https://www.circle.com/en/multi-chain-usdc/stellar
 */
export const TESTNET_CIRCLE_USDC_CONTRACT_ID =
  'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

export function getXlmContractId(): string {
  return Asset.native().contractId(NETWORK_PASSPHRASE);
}

export function getUsdcContractId(): string {
  return (
    process.env.NEXT_PUBLIC_USDC_CONTRACT_ID ?? TESTNET_CIRCLE_USDC_CONTRACT_ID
  );
}
