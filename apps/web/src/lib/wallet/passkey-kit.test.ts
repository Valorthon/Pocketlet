import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import {
  KNOWN_VULNERABLE_WALLET_WASM_HASHES,
  LEGACY_WALLET_WASM_HASHES,
} from 'passkey-kit';

interface CeremonyArgs {
  optionsJSON: Record<string, unknown>;
  [key: string]: unknown;
}

interface CapturedConfig {
  WebAuthn?: {
    startRegistration: (args: CeremonyArgs) => Promise<unknown>;
    startAuthentication: (args: CeremonyArgs) => Promise<unknown>;
  };
}

const mocks = vi.hoisted(() => ({
  configs: [] as unknown[],
  startRegistration: vi.fn(async () => ({})),
  startAuthentication: vi.fn(async () => ({})),
}));

// Only `PasskeyKit` is replaced — with a stand-in that records the config it
// was constructed with, which is the only way to observe the injected
// `WebAuthn` seam from outside. Every other export stays real so the
// re-exports at the top of passkey-kit.ts still resolve.
vi.mock('passkey-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('passkey-kit')>();
  return {
    ...actual,
    PasskeyKit: class {
      constructor(config: unknown) {
        mocks.configs.push(config);
      }
    },
  };
});

// IndexedDB does not exist under vitest's node environment.
vi.mock('passkey-kit/storage', () => ({
  IndexedDBStorage: class {},
}));

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: mocks.startRegistration,
  startAuthentication: mocks.startAuthentication,
}));

const originalEnv = {
  NEXT_PUBLIC_PASSKEY_RP_ID: process.env.NEXT_PUBLIC_PASSKEY_RP_ID,
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID,
};

async function importPasskeyKit() {
  vi.resetModules();
  const mod = await import('@/lib/wallet/passkey-kit');
  return mod;
}

describe('passkey-kit RP_ID', () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_PASSKEY_RP_ID = originalEnv.NEXT_PUBLIC_PASSKEY_RP_ID;
    process.env.WEBAUTHN_RP_ID = originalEnv.WEBAUTHN_RP_ID;
  });

  it('falls back to WEBAUTHN_RP_ID when NEXT_PUBLIC_PASSKEY_RP_ID is empty', async () => {
    process.env.NEXT_PUBLIC_PASSKEY_RP_ID = '';
    process.env.WEBAUTHN_RP_ID = 'localhost';
    const mod = await importPasskeyKit();
    expect(mod.RP_ID).toBe('localhost');
  });

  it('falls back to undefined when both env vars are empty', async () => {
    process.env.NEXT_PUBLIC_PASSKEY_RP_ID = '';
    delete process.env.WEBAUTHN_RP_ID;
    const mod = await importPasskeyKit();
    expect(mod.RP_ID).toBeUndefined();
  });

  it('prefers NEXT_PUBLIC_PASSKEY_RP_ID when set', async () => {
    process.env.NEXT_PUBLIC_PASSKEY_RP_ID = 'wallet.example.com';
    process.env.WEBAUTHN_RP_ID = 'localhost';
    const mod = await importPasskeyKit();
    expect(mod.RP_ID).toBe('wallet.example.com');
  });
});

/**
 * The client half of issue #56.
 *
 * `createPasskeyKit(challenge)` injects a wrapper through passkey-kit's
 * `WebAuthn` configuration point so the registration ceremony carries a
 * server-issued nonce instead of one the browser generated. Nothing else
 * exercises that wrapper — the ceremony itself needs a real authenticator —
 * so these tests pin the contract the routes depend on: registration gets the
 * server challenge, authentication is left alone, and a kit built without a
 * challenge does not override the kit's own implementation at all.
 */
describe('createPasskeyKit challenge injection', () => {
  beforeEach(() => {
    mocks.configs.length = 0;
    mocks.startRegistration.mockClear();
    mocks.startAuthentication.mockClear();
  });

  async function buildKitWebAuthn(challenge?: string) {
    const mod = await importPasskeyKit();
    mod.createPasskeyKit(challenge);
    const config = mocks.configs.at(-1);
    expect(config).toBeDefined();
    return (config as CapturedConfig).WebAuthn;
  }

  it('overwrites the browser-generated challenge with the server nonce', async () => {
    const webAuthn = await buildKitWebAuthn('server-issued-nonce');
    expect(webAuthn).toBeDefined();

    await webAuthn?.startRegistration({
      optionsJSON: {
        challenge: 'challenge-passkey-kit-generated-itself',
        rp: { id: 'localhost', name: 'Pocketlet' },
      },
    });

    expect(mocks.startRegistration).toHaveBeenCalledTimes(1);
    expect(mocks.startRegistration).toHaveBeenCalledWith({
      optionsJSON: {
        challenge: 'server-issued-nonce',
        rp: { id: 'localhost', name: 'Pocketlet' },
      },
    });
  });

  it('leaves the rest of the ceremony options untouched', async () => {
    const webAuthn = await buildKitWebAuthn('server-issued-nonce');

    await webAuthn?.startRegistration({
      optionsJSON: { challenge: 'discarded', user: { name: 'alice@example.com' } },
      useAutoRegister: true,
    });

    expect(mocks.startRegistration).toHaveBeenCalledWith({
      optionsJSON: {
        challenge: 'server-issued-nonce',
        user: { name: 'alice@example.com' },
      },
      useAutoRegister: true,
    });
  });

  it('delegates authentication without rewriting its challenge', async () => {
    const webAuthn = await buildKitWebAuthn('server-issued-nonce');

    // passkey-kit sets the authentication challenge to the transaction
    // payload, and the smart wallet verifies that binding on-chain — so this
    // one must pass straight through.
    await webAuthn?.startAuthentication({
      optionsJSON: { challenge: 'transaction-payload-hash' },
    });

    expect(mocks.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'transaction-payload-hash' },
    });
    expect(mocks.startRegistration).not.toHaveBeenCalled();
  });

  it('does not override WebAuthn at all when no challenge is passed', async () => {
    const webAuthn = await buildKitWebAuthn();
    expect(webAuthn).toBeUndefined();
    expect(mocks.configs.at(-1)).not.toHaveProperty('WebAuthn');
  });
});

/**
 * The WASM hash is the one value in this module that cannot be checked by
 * reading the code around it.
 *
 * passkey-kit 0.19's constructor throws a `ConfigurationError` for any
 * `walletWasmHash` in its known-vulnerable list, and `connectWallet` refuses a
 * wallet whose deployed code is not in `acceptedWasmHashes` — which defaults
 * to this one. Both failures happen against the network, so nothing in CI
 * would otherwise notice a bad edit. These assertions pin the published value
 * and check it against the kit's own blocklists, so a future kit bump that
 * retires this build fails here rather than at someone's wallet deploy.
 *
 * The value itself comes from upstream: passkey-kit's README.md and
 * SECURITY.md, and its deployment manifest docs/deployments-2026-09-01.md.
 * Never edit it without a new manifest entry to quote.
 */
describe('WALLET_WASM_HASH', () => {
  const CANONICAL =
    '97ce047884106b1c6c3bb40b8973cc48db1c4dad95c9e20462bf2c701daa764e';

  const originalHash = process.env.NEXT_PUBLIC_WALLET_WASM_HASH;

  afterEach(() => {
    if (originalHash === undefined) {
      delete process.env.NEXT_PUBLIC_WALLET_WASM_HASH;
    } else {
      process.env.NEXT_PUBLIC_WALLET_WASM_HASH = originalHash;
    }
  });

  it('defaults to the canonical upstream build', async () => {
    delete process.env.NEXT_PUBLIC_WALLET_WASM_HASH;
    const mod = await importPasskeyKit();
    expect(mod.WALLET_WASM_HASH).toBe(CANONICAL);
  });

  it('is not a build passkey-kit refuses to deploy from or connect to', () => {
    expect(KNOWN_VULNERABLE_WALLET_WASM_HASHES).not.toContain(CANONICAL);
    expect(LEGACY_WALLET_WASM_HASHES).not.toContain(CANONICAL);
  });

  it('is overridable per network', async () => {
    process.env.NEXT_PUBLIC_WALLET_WASM_HASH = 'a'.repeat(64);
    const mod = await importPasskeyKit();
    expect(mod.WALLET_WASM_HASH).toBe('a'.repeat(64));
  });
});

/**
 * The kit config Pocketlet builds, as the 0.19 line reads it.
 *
 * `horizonUrl` is what lets `confirmWalletCreation` and `connectWallet` find a
 * creation transaction that has aged out of RPC retention; the kit only
 * defaults it for the two well-known passphrases, and Pocketlet may run
 * against a custom network. The two accepted-hash lists are deliberately left
 * unset so they default to `[walletWasmHash]` — an override would accept code
 * this app has never deployed.
 */
describe('createPasskeyKit config', () => {
  beforeEach(() => {
    mocks.configs.length = 0;
  });

  interface KitConfig {
    walletWasmHash: string;
    horizonUrl?: string;
    acceptedWasmHashes?: string[];
    acceptedBirthWasmHashes?: string[];
    timeoutInSeconds?: number;
  }

  async function buildConfig(): Promise<KitConfig> {
    const mod = await importPasskeyKit();
    mod.createPasskeyKit();
    return mocks.configs.at(-1) as KitConfig;
  }

  it('passes the wallet WASM hash and a full-history Horizon URL', async () => {
    const config = await buildConfig();
    expect(config.walletWasmHash).toMatch(/^[0-9a-f]{64}$/);
    expect(config.horizonUrl).toBe('https://horizon-testnet.stellar.org');
  });

  it('leaves both accepted-hash lists at their default', async () => {
    const config = await buildConfig();
    expect(config.acceptedWasmHashes).toBeUndefined();
    expect(config.acceptedBirthWasmHashes).toBeUndefined();
  });
});

/**
 * Wallet-admin writes must be signed with `signAdmin`, never `sign`.
 *
 * `PasskeyKit.sign` refuses, by default, an auth entry that re-enters the
 * connected wallet — which is exactly what `add_signer`, `remove_signer` and
 * `upgrade` do. `signAdmin` declares that intent. The two have identical
 * signatures, so swapping one for the other typechecks silently and fails only
 * at signing time, against a real wallet, which nothing in CI reaches. This
 * scans the source instead.
 */
describe('wallet-admin transactions are signed with signAdmin', () => {
  const SRC_ROOT = join(__dirname, '..', '..');

  const ADMIN_BUILDERS = [
    'addSecp256r1',
    'updateSecp256r1',
    'addEd25519',
    'updateEd25519',
    'addPolicy',
    'updatePolicy',
    'remove',
    'upgrade',
  ];

  function sourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        sourceFiles(full, found);
      } else if (
        ['.ts', '.tsx'].includes(extname(entry)) &&
        !entry.endsWith('.test.ts') &&
        !entry.endsWith('.test.tsx')
      ) {
        found.push(full);
      }
    }
    return found;
  }

  /** `const foo = await kit.addEd25519(` -> `foo`. */
  const ASSIGNMENT = new RegExp(
    String.raw`\b(?:const|let)\s+(\w+)\s*=\s*await\s+kit\.(${ADMIN_BUILDERS.join('|')})\s*\(`,
    'g'
  );

  const adminTransactions = sourceFiles(SRC_ROOT).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(ASSIGNMENT)].map((match) => ({
      file: relative(SRC_ROOT, file),
      variable: match[1],
      builder: match[2],
      source,
    }));
  });

  it('finds the admin call sites it is meant to guard', () => {
    // A rename that makes the scan match nothing would otherwise leave this
    // whole suite passing vacuously.
    expect(adminTransactions.length).toBeGreaterThanOrEqual(6);
  });

  it.each(adminTransactions)(
    'signs $variable from kit.$builder in $file with signAdmin',
    ({ variable, source }) => {
      expect(source).not.toMatch(
        new RegExp(String.raw`kit\.sign\s*\(\s*${variable}\b`)
      );
      expect(source).toMatch(
        new RegExp(String.raw`kit\.signAdmin\s*\(\s*${variable}\b`)
      );
    }
  );
});
