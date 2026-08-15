import {
  Address,
  Contract,
  TransactionBuilder,
  rpc,
} from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE, RPC_URL } from './network';
import { getFeePayerKeypair, fundAccount } from './fee-payer';
import { i128ToBigInt } from './amount';

/**
 * Read an i128 token balance from a Stellar Asset Contract.
 *
 * A throw-away fee payer account sources the simulation so the call works even
 * when the holder account has no native XLM balance.
 */
export async function getTokenBalance(
  tokenContractId: string,
  holderAddress: string
): Promise<bigint> {
  const server = new rpc.Server(RPC_URL);
  const feePayer = getFeePayerKeypair();
  await fundAccount(feePayer.publicKey());
  const account = await server.getAccount(feePayer.publicKey());

  const tokenContract = new Contract(tokenContractId);
  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      tokenContract.call('balance', new Address(holderAddress).toScVal())
    )
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Balance simulation failed: ${sim.error}`);
  }
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error('Balance simulation returned no result');
  }
  return i128ToBigInt(sim.result.retval);
}
