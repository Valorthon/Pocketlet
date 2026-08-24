import {
  Address,
  BASE_FEE,
  FeeBumpTransaction,
  Operation,
  Transaction,
  TransactionBuilder,
  type OperationRecord,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE, RPC_URL } from './network';
import { fundAccount, getFeePayerKeypair } from './fee-payer';

function formatFailedResult(
  tx: rpc.Api.GetFailedTransactionResponse
): string {
  if (!tx.resultXdr) {
    return 'no result XDR';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultAny = tx.resultXdr as any;
  const resultUnion =
    typeof resultAny.result === 'function' ? resultAny.result() : resultAny.result;

  const txCode =
    resultUnion?.switch?.().name ?? resultUnion?.switch?.().value ?? 'unknown';

  const opResults =
    typeof resultUnion?.results === 'function'
      ? resultUnion.results()
      : resultUnion?.results;

  const opCodes = Array.isArray(opResults)
    ? opResults.map((op: unknown, idx: number) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const opAny = op as any;
        const opCode =
          opAny?.switch?.().name ?? opAny?.switch?.().value ?? 'unknown';

        const hostResult = opAny?.tr?.()?.invokeHostFunctionResult?.();
        if (hostResult) {
          const hostCode =
            hostResult?.switch?.().name ?? hostResult?.switch?.().value ?? 'unknown';
          return `op${idx}=${opCode},host=${hostCode}`;
        }

        return `op${idx}=${opCode}`;
      })
    : [];

  return opCodes.length
    ? `tx=${txCode}; ${opCodes.join('; ')}`
    : `tx=${txCode}`;
}

function resultXdrToBase64(
  resultXdr: rpc.Api.GetFailedTransactionResponse['resultXdr']
): string {
  if (!resultXdr) return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyResult = resultXdr as any;
  if (typeof anyResult.toXDR === 'function') {
    return anyResult.toXDR('base64');
  }
  if (typeof resultXdr === 'string') return resultXdr;
  return '';
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
        resultXdr: resultXdrToBase64(tx.resultXdr),
      });
      throw new Error(`Transaction failed: ${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
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

function isInvokeHostFunctionOp(
  op: OperationRecord
): op is Operation.InvokeHostFunction {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invokeArgs = hostFunction.invokeContract?.() as any;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invokeArgs = hostFunction.invokeContract?.() as any;
  if (!invokeArgs) {
    return null;
  }

  return (invokeArgs.args?.() as xdr.ScVal[] | undefined) ?? null;
}

/**
 * Read an Address ScVal as its string form (G.../C...).
 */
export function scValToAddress(scVal: xdr.ScVal): string {
  return Address.fromScVal(scVal).toString();
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
export function getAuthEntryAddresses(op: Operation.InvokeHostFunction): string[] {
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
export function hasSourceAccountAuth(op: Operation.InvokeHostFunction): boolean {
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

  const sponsoredTx = new TransactionBuilder(feePayerAccount, {
    fee,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
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
  await pollTransaction(server, result.hash);

  return { hash: result.hash };
}
