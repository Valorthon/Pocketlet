import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
