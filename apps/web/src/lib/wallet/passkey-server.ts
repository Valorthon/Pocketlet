import { PasskeyServer } from 'passkey-kit/server';
import { RPC_URL, NETWORK_PASSPHRASE } from './network';

const RELAYER_BASE_URL = process.env.PASSKEY_RELAYER_BASE_URL;
const RELAYER_API_KEY = process.env.PASSKEY_RELAYER_API_KEY;

/**
 * Create a server-side PasskeyServer client for fee-sponsored submission.
 *
 * This import must never be used in browser code because it carries the
 * relayer API secret. Keep all usages inside API routes or server actions.
 */
export function createPasskeyServer(): PasskeyServer {
  if (!RELAYER_BASE_URL || !RELAYER_API_KEY) {
    throw new Error(
      'PASSKEY_RELAYER_BASE_URL and PASSKEY_RELAYER_API_KEY must be configured'
    );
  }

  return new PasskeyServer({
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    relayer: {
      baseUrl: RELAYER_BASE_URL,
      apiKey: RELAYER_API_KEY,
    },
  });
}
