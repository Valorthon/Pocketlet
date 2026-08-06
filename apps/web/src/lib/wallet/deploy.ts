import {
  Address,
  Contract,
  Keypair,
  Networks,
  Operation,
  rpc,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
export const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

/**
 * Returns true when the configured Stellar network is the public/mainnet network.
 * The deployer key must be explicitly supplied in this environment.
 */
export function isProductionNetwork(): boolean {
  return (
    (process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET) ===
    Networks.PUBLIC
  );
}

const WASM_PATH = join(
  process.cwd(),
  '..',
  '..',
  'packages',
  'contracts',
  'target',
  'wasm32v1-none',
  'release',
  'pocketlet_wallet.wasm'
);

function getDataDir(): string {
  return process.env.POCKETLET_DATA_DIR ?? join(process.cwd(), '.data');
}

const DEX_WASM_PATH = join(
  process.cwd(),
  '..',
  '..',
  'packages',
  'contracts',
  'target',
  'wasm32v1-none',
  'release',
  'mock_dex.wasm'
);

export function loadDexWasm(): Buffer {
  return readFileSync(DEX_WASM_PATH);
}

export async function ensureDexWasmUploaded(
  server: rpc.Server,
  deployer: Keypair
): Promise<Buffer> {
  const wasm = loadDexWasm();
  const wasmHash = computeWasmHash(wasm);

  try {
    await server.getContractWasmByHash(wasmHash.toString('hex'));
    return wasmHash;
  } catch {
    // Wasm not on chain yet; upload it.
  }

  const account = await server.getAccount(deployer.publicKey());
  const uploadOp = Operation.uploadContractWasm({ wasm, source: deployer.publicKey() });
  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(uploadOp)
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(deployer);
  const result = await server.sendTransaction(prepared);
  const txResponse = await pollTransaction(server, result.hash);
  if (!txResponse.returnValue) {
    throw new Error('DEX wasm upload did not return a value');
  }
  const returnedHash = txResponse.returnValue.bytes();
  return Buffer.from(returnedHash);
}

export async function deployDex(server: rpc.Server, deployer: Keypair): Promise<string> {
  const wasmHash = await ensureDexWasmUploaded(server, deployer);

  const account = await server.getAccount(deployer.publicKey());
  const deployOp = Operation.createCustomContract({
    wasmHash,
    address: new Address(deployer.publicKey()),
    constructorArgs: [],
  });

  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(deployOp)
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(deployer);
  const result = await server.sendTransaction(prepared);
  const txResponse = await pollTransaction(server, result.hash);

  if (!txResponse.returnValue) {
    throw new Error('DEX deployment did not return a contract address');
  }
  return Address.fromScVal(txResponse.returnValue).toString();
}

function loadOrCreateDexContractId(): string | undefined {
  const fromEnv = process.env.DEX_CONTRACT_ID;
  if (fromEnv) {
    return fromEnv;
  }

  const dataDir = getDataDir();
  const dexFile = join(dataDir, 'dex_contract_id');
  if (existsSync(dexFile)) {
    return readFileSync(dexFile, 'utf-8').trim();
  }

  return undefined;
}

function saveDexContractId(contractId: string): void {
  const dataDir = getDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  writeFileSync(join(dataDir, 'dex_contract_id'), contractId);
}

/**
 * Returns the DEX contract address used for swaps.
 *
 * Order of precedence:
 *   1. `DEX_CONTRACT_ID` environment variable
 *   2. `apps/web/.data/dex_contract_id` (auto-generated on testnet)
 *   3. Auto-deploy the bundled `mock_dex.wasm` once and cache the address
 *
 * In production, always set `DEX_CONTRACT_ID` via a secrets manager.
 */
export async function getDexContractId(): Promise<string> {
  const cached = loadOrCreateDexContractId();
  if (cached) {
    return cached;
  }

  const server = new rpc.Server(RPC_URL);
  const deployer = getPlatformKeypair();
  await fundAccount(deployer.publicKey());
  const contractId = await deployDex(server, deployer);
  saveDexContractId(contractId);
  console.warn(
    'DEX_CONTRACT_ID is not set. The bundled mock_dex.wasm has been deployed for testnet and saved to:'
  );
  console.warn(join(getDataDir(), 'dex_contract_id'));
  return contractId;
}

function loadOrCreateDeployerSecret(): string {
  const fromEnv = process.env.PLATFORM_SECRET_KEY;
  if (fromEnv) {
    return fromEnv;
  }

  if (isProductionNetwork()) {
    throw new Error(
      'PLATFORM_SECRET_KEY is required on the Stellar public network. ' +
        'Provide a fixed, funded deployer account secret via a secrets manager.'
    );
  }

  const dataDir = getDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const secretFile = join(dataDir, 'platform_secret');
  if (existsSync(secretFile)) {
    return readFileSync(secretFile, 'utf-8').trim();
  }

  const kp = Keypair.random();
  const secret = kp.secret();
  writeFileSync(secretFile, secret, { mode: 0o600 });
  console.warn(
    'PLATFORM_SECRET_KEY is not set. A persistent deployer keypair has been generated for testnet and saved to:'
  );
  console.warn(secretFile);
  return secret;
}

/**
 * Returns the platform deployer keypair.
 *
 * The deployer account pays the Stellar network fees and rent to upload the
 * wallet WASM and create each user's smart-wallet contract instance. It is
 * also stored as the wallet's `recovery_admin`, allowing the platform to
 * rotate a lost owner public key after email verification.
 *
 * Order of precedence:
 *   1. `PLATFORM_SECRET_KEY` environment variable
 *   2. `apps/web/.data/platform_secret` (auto-generated once in testnet)
 *
 * On the Stellar public network, `PLATFORM_SECRET_KEY` must be set via a
 * secrets manager; the function will throw if it is missing.
 */
export function getPlatformKeypair(): Keypair {
  const secret = loadOrCreateDeployerSecret();
  return Keypair.fromSecret(secret);
}

function getAxiosErrorDetail(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const maybe = err as { response?: { data?: { detail?: string } }; message?: string };
    return maybe.response?.data?.detail ?? maybe.message;
  }
  return undefined;
}

/**
 * Ensures the given account has a starting balance.
 *
 * On testnet this requests funds from Friendbot. On the public network the
 * deployer is expected to be funded before the app starts, so this is a no-op.
 */
export async function fundAccount(publicKey: string): Promise<void> {
  if (isProductionNetwork()) {
    return;
  }

  try {
    const server = new rpc.Server(RPC_URL);
    await server.requestAirdrop(publicKey);
  } catch (err) {
    // Friendbot returns 400 once an account already has the starting balance.
    // That is expected across restarts, so only log real failures.
    const detail = getAxiosErrorDetail(err);
    if (detail?.toLowerCase().includes('already funded')) {
      console.log(`Friendbot: ${publicKey} is already funded.`);
      return;
    }
    console.log('Friendbot funding attempt failed:', detail ?? err);
  }
}

export function loadWalletWasm(): Buffer {
  return readFileSync(WASM_PATH);
}

export function computeWasmHash(wasm: Buffer): Buffer {
  return createHash('sha256').update(wasm).digest();
}

export async function ensureWasmUploaded(server: rpc.Server, deployer: Keypair): Promise<Buffer> {
  const wasm = loadWalletWasm();
  const wasmHash = computeWasmHash(wasm);

  try {
    await server.getContractWasmByHash(wasmHash.toString('hex'));
    return wasmHash;
  } catch {
    // Wasm not on chain yet; upload it.
  }

  const account = await server.getAccount(deployer.publicKey());
  const uploadOp = Operation.uploadContractWasm({ wasm, source: deployer.publicKey() });
  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(uploadOp)
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(deployer);
  const result = await server.sendTransaction(prepared);
  const txResponse = await pollTransaction(server, result.hash);
  if (!txResponse.returnValue) {
    throw new Error('Wasm upload did not return a value');
  }
  // Return value is the wasm hash bytes.
  const returnedHash = txResponse.returnValue.bytes();
  return Buffer.from(returnedHash);
}

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
    resultUnion?.switch?.().name ??
    resultUnion?.switch?.().value ??
    'unknown';

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
            hostResult?.switch?.().name ??
            hostResult?.switch?.().value ??
            'unknown';
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

function i128ToBigInt(value: xdr.ScVal): bigint {
  const i128 = value.i128();
  const hi = i128.hi().toBigInt();
  const lo = i128.lo().toBigInt();
  return (hi << 64n) + lo;
}

export async function getTokenBalance(
  tokenContractId: string,
  holderAddress: string
): Promise<bigint> {
  const server = new rpc.Server(RPC_URL);
  const deployer = getPlatformKeypair();
  await fundAccount(deployer.publicKey());
  const account = await server.getAccount(deployer.publicKey());

  const tokenContract = new Contract(tokenContractId);
  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(tokenContract.call('balance', new Address(holderAddress).toScVal()))
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

export async function deployWallet(
  server: rpc.Server,
  deployer: Keypair,
  ownerPublicKey: Buffer
): Promise<string> {
  const wasmHash = await ensureWasmUploaded(server, deployer);

  const account = await server.getAccount(deployer.publicKey());
  const recoveryAdmin = new Address(deployer.publicKey());

  const deployOp = Operation.createCustomContract({
    wasmHash,
    address: new Address(deployer.publicKey()),
    constructorArgs: [xdr.ScVal.scvBytes(ownerPublicKey), recoveryAdmin.toScVal()],
  });

  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(deployOp)
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(deployer);
  const result = await server.sendTransaction(prepared);
  const txResponse = await pollTransaction(server, result.hash);

  if (!txResponse.returnValue) {
    throw new Error('Wallet deployment did not return a contract address');
  }
  const contractAddress = Address.fromScVal(txResponse.returnValue).toString();
  return contractAddress;
}

