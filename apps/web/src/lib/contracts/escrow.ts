import {
  Address,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import { AssembledTransaction } from '@stellar/stellar-sdk/contract';
import { NETWORK_PASSPHRASE, RPC_URL } from '@/lib/wallet/network';

function getEscrowContractId(): string {
  const id = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID;
  if (!id) {
    throw new Error('NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured');
  }
  return id;
}

function addressScVal(addr: string): xdr.ScVal {
  return new Address(addr).toScVal();
}

function bytes32ScVal(hex: string): xdr.ScVal {
  return nativeToScVal(Buffer.from(hex, 'hex'), { type: 'bytes' });
}

interface EscrowTxOptions {
  publicKey: string;
}

/**
 * Shape of the Deposit struct returned by the escrow contract.
 * Mirrors the `Deposit` type defined in `contracts/escrow/src/lib.rs`.
 */
export interface EscrowDeposit {
  sender: string;
  token: string;
  amount: bigint;
  recipientIdHash: string;
  expiry: bigint;
  claimed: boolean;
}

/**
 * Frontend wrapper for `EscrowContract.deposit`.
 * Builds an unsigned `invoke_host_function` transaction that calls the
 * contract's `deposit` method with the given parameters.
 *
 * Contract: `deposit(sender, token, amount, claim_hash, recipient_id_hash, expiry)`
 * Frontend: `prepareEscrowDepositTx(options, tokenContractId, amount, claimHashHex, recipientIdHashHex, expiryLedger)`
 */
export async function prepareEscrowDepositTx(
  options: EscrowTxOptions,
  tokenContractId: string,
  amount: bigint,
  claimHashHex: string,
  recipientIdHashHex: string,
  expiryLedger: number
): Promise<AssembledTransaction<null>> {
  return AssembledTransaction.build({
    method: 'deposit',
    args: [
      addressScVal(options.publicKey),
      addressScVal(tokenContractId),
      nativeToScVal(amount, { type: 'i128' }),
      bytes32ScVal(claimHashHex),
      bytes32ScVal(recipientIdHashHex),
      nativeToScVal(BigInt(expiryLedger), { type: 'u64' }),
    ],
    contractId: getEscrowContractId(),
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: options.publicKey,
    parseResultXdr: () => null,
  });
}

/**
 * Frontend wrapper for `EscrowContract.claim`.
 * Builds an unsigned `invoke_host_function` transaction that calls the
 * contract's `claim` method.
 *
 * Contract: `claim(secret, recipient_wallet)`
 * Frontend: `prepareEscrowClaimTx(options, secretHex, recipientWallet)`
 */
export async function prepareEscrowClaimTx(
  options: EscrowTxOptions,
  secretHex: string,
  recipientWallet: string
): Promise<AssembledTransaction<null>> {
  return AssembledTransaction.build({
    method: 'claim',
    args: [
      bytes32ScVal(secretHex),
      addressScVal(recipientWallet),
    ],
    contractId: getEscrowContractId(),
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: options.publicKey,
    parseResultXdr: () => null,
  });
}

/**
 * Frontend wrapper for `EscrowContract.refund`.
 * Builds an unsigned `invoke_host_function` transaction that calls the
 * contract's `refund` method.
 *
 * Contract: `refund(claim_hash)`
 * Frontend: `prepareEscrowRefundTx(options, claimHashHex)`
 */
export async function prepareEscrowRefundTx(
  options: EscrowTxOptions,
  claimHashHex: string
): Promise<AssembledTransaction<null>> {
  return AssembledTransaction.build({
    method: 'refund',
    args: [bytes32ScVal(claimHashHex)],
    contractId: getEscrowContractId(),
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: options.publicKey,
    parseResultXdr: () => null,
  });
}

/**
 * Frontend wrapper for `EscrowContract.get_deposit`.
 * Simulates a read-only `invoke_host_function` call to fetch a deposit's
 * metadata. Returns `null` if no deposit exists for the given claim hash.
 *
 * Contract: `get_deposit(claim_hash) -> Option<Deposit>`
 * Frontend: `prepareEscrowGetDepositTx(options, claimHashHex) -> EscrowDeposit | null`
 */
export async function prepareEscrowGetDepositTx(
  options: EscrowTxOptions,
  claimHashHex: string
): Promise<EscrowDeposit | null> {
  const server = new rpc.Server(RPC_URL);
  const account = await server.getAccount(options.publicKey);

  const contract = new Contract(getEscrowContractId());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('get_deposit', bytes32ScVal(claimHashHex)))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Simulation failed: ${simulation.error}`);
  }
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new Error('Simulation did not succeed');
  }

  const result = simulation.result;
  if (!result) {
    return null;
  }

  const native = scValToNative(result.retval);
  if (native === null) {
    return null;
  }

  const deposit = native as Record<string, unknown>;
  return {
    sender: String(deposit.sender),
    token: String(deposit.token),
    amount: BigInt(deposit.amount as string | number | bigint),
    recipientIdHash: (deposit.recipient_id_hash as Buffer).toString('hex'),
    expiry: BigInt(deposit.expiry as string | number | bigint),
    claimed: Boolean(deposit.claimed),
  };
}
