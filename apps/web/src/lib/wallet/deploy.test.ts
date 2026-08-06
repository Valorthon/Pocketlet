import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Account, Keypair, Networks, rpc } from '@stellar/stellar-sdk';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fundAccount, getPlatformKeypair, isProductionNetwork } from './deploy';

const VALID_SECRET_KEY =
  'SBI2ATXEXZNK7L53NN4AWQMVCZB2HVULL3LKM7FYVZWL25IUHJOE65YS';
const PUBLIC_KEY = 'GATVJDFPIPADU74ALX4344HEQQZ2LGMNWABPXBOWYMVXM37KMTTUALTU';

describe('isProductionNetwork', () => {
  let originalPassphrase: string | undefined;

  beforeEach(() => {
    originalPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
  });

  afterEach(() => {
    if (originalPassphrase !== undefined) {
      process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = originalPassphrase;
    } else {
      delete process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
    }
  });

  it('returns true on public network', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    expect(isProductionNetwork()).toBe(true);
  });

  it('returns false on testnet', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    expect(isProductionNetwork()).toBe(false);
  });

  it('defaults to false when network passphrase is unset', () => {
    delete process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
    expect(isProductionNetwork()).toBe(false);
  });
});

describe('getPlatformKeypair', () => {
  let tempDir: string;
  let originalPassphrase: string | undefined;
  let originalSecret: string | undefined;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pocketlet-deploy-test-'));
    process.env.POCKETLET_DATA_DIR = tempDir;
    originalPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
    originalSecret = process.env.PLATFORM_SECRET_KEY;
    delete process.env.PLATFORM_SECRET_KEY;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (originalPassphrase !== undefined) {
      process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = originalPassphrase;
    } else {
      delete process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
    }
    if (originalSecret !== undefined) {
      process.env.PLATFORM_SECRET_KEY = originalSecret;
    } else {
      delete process.env.PLATFORM_SECRET_KEY;
    }
    delete process.env.POCKETLET_DATA_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses PLATFORM_SECRET_KEY when set on testnet', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    process.env.PLATFORM_SECRET_KEY = VALID_SECRET_KEY;
    const kp = getPlatformKeypair();
    expect(kp.secret()).toBe(VALID_SECRET_KEY);
  });

  it('uses PLATFORM_SECRET_KEY when set on public network', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.PLATFORM_SECRET_KEY = VALID_SECRET_KEY;
    const kp = getPlatformKeypair();
    expect(kp.secret()).toBe(VALID_SECRET_KEY);
  });

  it('generates and caches a testnet keypair when env secret is missing', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    const kp1 = getPlatformKeypair();
    const kp2 = getPlatformKeypair();

    expect(kp1.secret()).toBe(kp2.secret());
    expect(kp1.publicKey()).toBe(kp2.publicKey());
    expect(Keypair.fromSecret(kp1.secret()).publicKey()).toBe(kp1.publicKey());

    const secretFile = join(tempDir, 'platform_secret');
    expect(existsSync(secretFile)).toBe(true);
    expect(readFileSync(secretFile, 'utf-8').trim()).toBe(kp1.secret());
    expect(warnSpy).toHaveBeenCalled();
  });

  it('throws on public network when PLATFORM_SECRET_KEY is missing', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    expect(() => getPlatformKeypair()).toThrow(
      'PLATFORM_SECRET_KEY is required on the Stellar public network'
    );
  });
});

describe('fundAccount', () => {
  let originalPassphrase: string | undefined;
  let requestAirdropSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
    requestAirdropSpy = vi
      .spyOn(rpc.Server.prototype, 'requestAirdrop')
      .mockResolvedValue(new Account(PUBLIC_KEY, '0'));
  });

  afterEach(() => {
    requestAirdropSpy.mockRestore();
    if (originalPassphrase !== undefined) {
      process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = originalPassphrase;
    } else {
      delete process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
    }
  });

  it('does not call requestAirdrop on public network', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    await fundAccount(PUBLIC_KEY);
    expect(requestAirdropSpy).not.toHaveBeenCalled();
  });

  it('calls requestAirdrop on testnet', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    await fundAccount(PUBLIC_KEY);
    expect(requestAirdropSpy).toHaveBeenCalledWith(PUBLIC_KEY);
  });
});
