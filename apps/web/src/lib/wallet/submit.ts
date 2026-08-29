import {
  Account,
  Address,
  BASE_FEE,
  FeeBumpTransaction,
  Operation,
  Transaction,
  TransactionBuilder,
  type OperationRecord,
  rpc,
  xdr,
  scValToNative,
} from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE, RPC_URL } from './network';
import { fundAccount, getFeePayerKeypair } from './fee-payer';

function getOperationResultCode(
  op: xdr.OperationResult
): { name: string; value: number | string } | null {
  const switchResult = op.switch?.();
  if (!switchResult) {
    return null;
  }
  return {
    name: switchResult.name,
    value: switchResult.value,
  };
}

function getInvokeHostFunctionResultCode(
  op: xdr.OperationResult
): { name: string; value: number | string } | null {
  const tr = op.tr?.();
  if (!tr) {
    return null;
  }
  const hostResult = tr.invokeHostFunctionResult?.();
  if (!hostResult) {
    return null;
  }
  const switchResult = hostResult.switch?.();
  if (!switchResult) {
    return null;
  }
  return {
    name: switchResult.name,
    value: switchResult.value,
  };
}

function formatTransactionResult(result: xdr.TransactionResult): string {
  const resultUnion = result.result();
  const txSwitch = resultUnion.switch();
  const txCode = txSwitch.name ?? txSwitch.value ?? 'unknown';

  const opResults = resultUnion.results?.() ?? [];

  const opCodes = opResults.map((op, idx) => {
    const opCode = getOperationResultCode(op);
    const hostCode = getInvokeHostFunctionResultCode(op);

    if (opCode && hostCode) {
      return `op${idx}=${opCode.name},host=${hostCode.name}`;
    }
    if (opCode) {
      return `op${idx}=${opCode.name}`;
    }
    return `op${idx}=unknown`;
  });

  return opCodes.length
    ? `tx=${txCode}; ${opCodes.join('; ')}`
    : `tx=${txCode}`;
}

function formatFailedResult(
  tx: rpc.Api.GetFailedTransactionResponse
): string {
  if (!tx.resultXdr) {
    return 'no result XDR';
  }

  return formatTransactionResult(tx.resultXdr);
}

export async function pollTransaction(
  server: rpc.Server,
  hash: string,
  attempts = 20
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  for (let i = 0; i < attempts; i++) {
    const tx = await server.getTransaction(hash);
    if (tx.status === 'SUCCESS') {
      return tx as rpc.Api.GetSuccessfulTransactionResponse;
    }
    if (tx.status === 'FAILED') {
      const detail = formatFailedResult(tx);
      console.error('Transaction failed:', {
        detail,
        txHash: tx.txHash,
        ledger: tx.ledger,
      });
      throw new Error(`Transaction failed: ${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Transaction polling timed out');
}

/**
 * Fast-poll variant: 10 attempts × 500 ms = 5 s max. Use when the tx is
 * expected to land quickly (e.g. testnet during onboarding) and the caller
 * wants a faster response. Still blocks until SUCCESS or FAILED.
 */
export async function pollTransactionFast(
  server: rpc.Server,
  hash: string
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  for (let i = 0; i < 10; i++) {
    const tx = await server.getTransaction(hash);
    if (tx.status === 'SUCCESS') {
      return tx as rpc.Api.GetSuccessfulTransactionResponse;
    }
    if (tx.status === 'FAILED') {
      const detail = formatFailedResult(tx);
      console.error('Transaction failed (fast poll):', {
        detail,
        txHash: tx.txHash,
        ledger: tx.ledger,
      });
      throw new Error(`Transaction failed: ${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Transaction polling timed out');
}

/**
 * Validate that the given transaction envelope is a Soroban transaction that
 * can be submitted by the fee payer. Returns the parsed Transaction.
 */
export function parseSorobanTransaction(signedXdr: string): Transaction {
  const envelope = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

  if (envelope instanceof FeeBumpTransaction) {
    throw new Error('Fee-bump envelopes are not accepted; submit the inner transaction');
  }

  const hasSorobanOp = envelope.operations.some(
    (op) => op.type === 'invokeHostFunction'
  );
  if (!hasSorobanOp) {
    throw new Error('Transaction does not contain a Soroban invoke_host_function operation');
  }

  return envelope;
}

interface InvokeHostFunctionOperation {
  type: 'invokeHostFunction';
  func: xdr.HostFunction;
  auth?: xdr.SorobanAuthorizationEntry[];
}

function isInvokeHostFunctionOp(
  op: OperationRecord
): op is OperationRecord & InvokeHostFunctionOperation {
  return op.type === 'invokeHostFunction';
}

/**
 * Extract the invoked contract address and function name from a Soroban
 * operation, when available.
 */
export function getInvokeContractDetails(
  op: OperationRecord
): { contractId: string; functionName: string } | null {
  if (!isInvokeHostFunctionOp(op)) {
    return null;
  }

  const hostFunction = op.func;
  const switchName = hostFunction.switch?.().name;
  if (switchName !== 'hostFunctionTypeInvokeContract') {
    return null;
  }

  const invokeArgs = hostFunction.invokeContract?.();
  if (!invokeArgs) {
    return null;
  }

  const contractAddress = invokeArgs.contractAddress?.();
  const functionName = invokeArgs.functionName?.();
  if (!contractAddress || !functionName) {
    return null;
  }

  return {
    contractId: Address.fromScAddress(contractAddress).toString(),
    functionName: String(functionName),
  };
}

/**
 * Extract the raw invoke_contract args from a Soroban operation.
 */
export function getInvokeContractArgs(op: OperationRecord): xdr.ScVal[] | null {
  if (!isInvokeHostFunctionOp(op)) {
    return null;
  }

  const hostFunction = op.func;
  const switchName = hostFunction.switch?.().name;
  if (switchName !== 'hostFunctionTypeInvokeContract') {
    return null;
  }

  const invokeArgs = hostFunction.invokeContract?.();
  if (!invokeArgs) {
    return null;
  }

  return invokeArgs.args?.() ?? [];
}

/**
 * Read an Address ScVal as its string form (G.../C...).
 */
export function scValToAddress(scVal: xdr.ScVal): string {
  return Address.fromScVal(scVal).toString();
}

/**
 * Read a Bytes ScVal as a Buffer.
 */
export function scValToBytes(scVal: xdr.ScVal): Buffer {
  return Buffer.from(scVal.bytes());
}

/**
 * Read a U64 ScVal as a bigint.
 */
export function scValToU64(scVal: xdr.ScVal): bigint {
  return scValToNative(scVal) as bigint;
}

function getAddressCredentials(
  credentials: xdr.SorobanCredentials
): xdr.SorobanAddressCredentials | null {
  const switchName = credentials.switch().name;

  if (switchName === 'sorobanCredentialsAddress') {
    return credentials.address();
  }
  if (switchName === 'sorobanCredentialsAddressV2') {
    return credentials.addressV2();
  }
  if (switchName === 'sorobanCredentialsAddressWithDelegates') {
    return credentials.addressWithDelegates().addressCredentials();
  }

  return null;
}

/**
 * Return the wallet addresses that appear in an invoke_host_function
 * operation's address-bound authorization entries.
 */
export function getAuthEntryAddresses(op: OperationRecord): string[] {
  if (!isInvokeHostFunctionOp(op)) {
    return [];
  }

  const addresses = new Set<string>();

  for (const entry of op.auth ?? []) {
    const credentials = entry.credentials();
    const addressCredentials = getAddressCredentials(credentials);
    if (addressCredentials) {
      addresses.add(Address.fromScAddress(addressCredentials.address()).toString());
    }
  }

  return [...addresses];
}

/**
 * Return true if any auth entry in the operation uses source-account
 * authorization, which would require the transaction source account to sign.
 */
export function hasSourceAccountAuth(op: OperationRecord): boolean {
  if (!isInvokeHostFunctionOp(op)) {
    return false;
  }

  return (
    op.auth?.some(
      (entry) => entry.credentials().switch().name === 'sorobanCredentialsSourceAccount'
    ) ?? false
  );
}

/**
 * Submit a user-authorized Soroban transaction to the network with the platform
 * fee payer as the source account.
 *
 * The input must be a base64-encoded inner Transaction envelope (not a fee-bump)
 * containing exactly one `invoke_host_function` operation. The operation's auth
 * entries must already be signed by the user's wallet. The server rebuilds the
 * transaction with the fee payer as the source account, re-simulates to obtain
 * current resource fees and Soroban data, signs with the fee payer, and submits
 * directly via RPC.
 */
export async function submitSignedTransaction(signedXdr: string): Promise<{ hash: string }> {
  const server = new rpc.Server(RPC_URL);
  const feePayer = getFeePayerKeypair();
  await fundAccount(feePayer.publicKey());

  const innerTx = parseSorobanTransaction(signedXdr);

  if (innerTx.operations.length !== 1) {
    throw new Error('Sponsored transaction must contain exactly one operation');
  }

  const op = innerTx.operations[0];
  if (!isInvokeHostFunctionOp(op)) {
    throw new Error('Sponsored transaction must be an invoke_host_function operation');
  }

  const feePayerAccount = await server.getAccount(feePayer.publicKey());
  const feePayerSequence = feePayerAccount.sequenceNumber();

  const tempTx = new TransactionBuilder(feePayerAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: op.func,
        auth: op.auth,
      })
    )
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tempTx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Simulation failed: ${simulation.error}`);
  }
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new Error('Simulation did not succeed');
  }

  const sorobanData = simulation.transactionData.build();
  const fee = String(Number(simulation.minResourceFee) + Number(BASE_FEE));

  // Build the sponsored transaction from a fresh Account using the sequence we
  // fetched from the network. Reusing feePayerAccount would use the next
  // sequence because building tempTx consumed one internally.
  const sponsoredTx = new TransactionBuilder(
    new Account(feePayer.publicKey(), feePayerSequence),
    {
      fee,
      networkPassphrase: NETWORK_PASSPHRASE,
    }
  )
    .setSorobanData(sorobanData)
    .addOperation(
      Operation.invokeHostFunction({
        func: op.func,
        auth: op.auth,
      })
    )
    .setTimeout(30)
    .build();

  sponsoredTx.sign(feePayer);

  const result = await server.sendTransaction(sponsoredTx);

  if (result.status === 'ERROR') {
    const detail = result.errorResult
      ? formatTransactionResult(result.errorResult)
      : 'no error result XDR';
    throw new Error(`sendTransaction failed: ${detail}`);
  }
  if (result.status !== 'PENDING' && result.status !== 'DUPLICATE') {
    throw new Error(`sendTransaction returned unexpected status: ${result.status}`);
  }

  await pollTransaction(server, result.hash);

  return { hash: result.hash };
}

/**
 * Fast variant of {@link submitSignedTransaction} that polls with a 5 s
 * timeout instead of 20 s. Suitable for onboarding flows where the user is
 * waiting on a banner. Still waits for ledger confirmation — no optimistic
 * treatment of PENDING.
 */
export async function submitSignedTransactionFast(
  signedXdr: string
): Promise<{ hash: string }> {
  const server = new rpc.Server(RPC_URL);
  const feePayer = getFeePayerKeypair();
  await fundAccount(feePayer.publicKey());

  const innerTx = parseSorobanTransaction(signedXdr);

  if (innerTx.operations.length !== 1) {
    throw new Error('Sponsored transaction must contain exactly one operation');
  }

  const op = innerTx.operations[0];
  if (!isInvokeHostFunctionOp(op)) {
    throw new Error('Sponsored transaction must be an invoke_host_function operation');
  }

  const feePayerAccount = await server.getAccount(feePayer.publicKey());
  const feePayerSequence = feePayerAccount.sequenceNumber();

  const tempTx = new TransactionBuilder(feePayerAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: op.func,
        auth: op.auth,
      })
    )
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tempTx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Simulation failed: ${simulation.error}`);
  }
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new Error('Simulation did not succeed');
  }

  const sorobanData = simulation.transactionData.build();
  const fee = String(Number(simulation.minResourceFee) + Number(BASE_FEE));

  const sponsoredTx = new TransactionBuilder(
    new Account(feePayer.publicKey(), feePayerSequence),
    {
      fee,
      networkPassphrase: NETWORK_PASSPHRASE,
    }
  )
    .setSorobanData(sorobanData)
    .addOperation(
      Operation.invokeHostFunction({
        func: op.func,
        auth: op.auth,
      })
    )
    .setTimeout(30)
    .build();

  sponsoredTx.sign(feePayer);

  const result = await server.sendTransaction(sponsoredTx);

  if (result.status === 'ERROR') {
    const detail = result.errorResult
      ? formatTransactionResult(result.errorResult)
      : 'no error result XDR';
    throw new Error(`sendTransaction failed: ${detail}`);
  }
  if (result.status !== 'PENDING' && result.status !== 'DUPLICATE') {
    throw new Error(`sendTransaction returned unexpected status: ${result.status}`);
  }

  await pollTransactionFast(server, result.hash);

  return { hash: result.hash };
}
