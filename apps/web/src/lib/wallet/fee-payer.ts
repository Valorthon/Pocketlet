import { Keypair, rpc } from '@stellar/stellar-sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NETWORK_PASSPHRASE, RPC_URL, isProductionNetwork } from './network';

const FEE_PAYER_SECRET_KEY = process.env.FEE_PAYER_SECRET_KEY;

function getDataDir(): string {
  return process.env.POCKETLET_DATA_DIR ?? join(process.cwd(), '.data');
}

function loadOrCreateFeePayerSecret(): string {
  const fromEnv = FEE_PAYER_SECRET_KEY;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }

  if (isProductionNetwork()) {
    throw new Error(
      'FEE_PAYER_SECRET_KEY is required on the Stellar public network. ' +
        'Provide a funded account secret via a secrets manager.'
    );
  }

  const dataDir = getDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const secretFile = join(dataDir, 'fee_payer_secret');
  if (existsSync(secretFile)) {
    return readFileSync(secretFile, 'utf-8').trim();
  }

  const kp = Keypair.random();
  const secret = kp.secret();
  writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

/**
 * Returns the platform fee payer keypair.
 *
 * This account pays Stellar network fees on behalf of users. It never holds
 * user funds and is not a signer on any user wallet.
 *
 * Order of precedence:
 *   1. `FEE_PAYER_SECRET_KEY` environment variable
 *   2. `apps/web/.data/fee_payer_secret` (auto-generated once on testnet)
 *
 * On the Stellar public network, `FEE_PAYER_SECRET_KEY` must be set via a
 * secrets manager; the function will throw if it is missing.
 */
export function getFeePayerKeypair(): Keypair {
  const secret = loadOrCreateFeePayerSecret();
  return Keypair.fromSecret(secret);
}

function getAxiosErrorDetail(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const maybe = err as {
      response?: { data?: { detail?: string } };
      message?: string;
    };
    return maybe.response?.data?.detail ?? maybe.message;
  }
  return undefined;
}

/**
 * Ensures the given account has a starting balance.
 *
 * On testnet this requests funds from Friendbot. On the public network the
 * fee payer is expected to be funded before the app starts, so this is a no-op.
 */
export async function fundAccount(publicKey: string): Promise<void> {
  if (isProductionNetwork()) {
    return;
  }

  const server = new rpc.Server(RPC_URL);

  try {
    await server.requestAirdrop(publicKey);
  } catch (err) {
    // Friendbot returns 400 once an account already has the starting balance.
    // That is expected across restarts, so only log real failures.
    const detail = getAxiosErrorDetail(err);
    if (detail?.toLowerCase().includes('already funded')) {
      return;
    }
    console.error('Friendbot funding attempt failed:', detail ?? err);
  }
}

/**
 * Re-export production-network detection from the canonical network module.
 */
export { isProductionNetwork };

/**
 * RPC URL and network passphrase used for fee-payer operations.
 */
export { RPC_URL, NETWORK_PASSPHRASE };
