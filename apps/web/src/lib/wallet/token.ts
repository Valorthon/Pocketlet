import { SACClient } from 'passkey-kit';
import { NETWORK_PASSPHRASE, RPC_URL } from './network';

/**
 * Read an i128 token balance from a Stellar Asset Contract.
 *
 * Uses passkey-kit's SACClient (a thin factory around sac-sdk) to simulate the
 * SEP-41 `balance(id)` call. Simulation uses the default read-only account, so
 * this works even when the holder account has no native XLM balance.
 */
export async function getTokenBalance(
  tokenContractId: string,
  holderAddress: string
): Promise<bigint> {
  const sac = new SACClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const token = sac.getSACClient(tokenContractId);

  const tx = await token.balance({ id: holderAddress });
  return tx.result;
}
