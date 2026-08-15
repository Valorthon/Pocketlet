import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Account, Keypair, Networks, rpc } from '@stellar/stellar-sdk';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  it('returns true on public network', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    vi.resetModules();
    const { isProductionNetwork } = await import('./fee-payer');
    expect(isProductionNetwork()).toBe(true);
  });

  it('returns false on testnet', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    vi.resetModules();
    const { isProductionNetwork } = await import('./fee-payer');
    expect(isProductionNetwork()).toBe(false);
  });

  it('defaults to false when network passphrase is unset', async () => {
    delete process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
    vi.resetModules();
    const { isProductionNetwork } = await import('./fee-payer');
    expect(isProductionNetwork()).toBe(false);
  });
});

describe('getFeePayerKeypair', () => {
  let tempDir: string;
  let originalPassphrase: string | undefined;
  let originalSecret: string | undefined;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pocketlet-fee-payer-test-'));
    process.env.POCKETLET_DATA_DIR = tempDir;
    originalPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
    originalSecret = process.env.FEE_PAYER_SECRET_KEY;
    delete process.env.FEE_PAYER_SECRET_KEY;
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
      process.env.FEE_PAYER_SECRET_KEY = originalSecret;
    } else {
      delete process.env.FEE_PAYER_SECRET_KEY;
    }
    delete process.env.POCKETLET_DATA_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses FEE_PAYER_SECRET_KEY when set on testnet', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    process.env.FEE_PAYER_SECRET_KEY = VALID_SECRET_KEY;
    vi.resetModules();
    const { getFeePayerKeypair } = await import('./fee-payer');
    const kp = getFeePayerKeypair();
    expect(kp.secret()).toBe(VALID_SECRET_KEY);
  });

  it('uses FEE_PAYER_SECRET_KEY when set on public network', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.FEE_PAYER_SECRET_KEY = VALID_SECRET_KEY;
    vi.resetModules();
    const { getFeePayerKeypair } = await import('./fee-payer');
    const kp = getFeePayerKeypair();
    expect(kp.secret()).toBe(VALID_SECRET_KEY);
  });

  it('generates and caches a testnet keypair when env secret is missing', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    vi.resetModules();
    const { getFeePayerKeypair } = await import('./fee-payer');
    const kp1 = getFeePayerKeypair();
    const kp2 = getFeePayerKeypair();

    expect(kp1.secret()).toBe(kp2.secret());
    expect(kp1.publicKey()).toBe(kp2.publicKey());
    expect(Keypair.fromSecret(kp1.secret()).publicKey()).toBe(kp1.publicKey());

    const secretFile = join(tempDir, 'fee_payer_secret');
    expect(existsSync(secretFile)).toBe(true);
    expect(readFileSync(secretFile, 'utf-8').trim()).toBe(kp1.secret());
    expect(warnSpy).toHaveBeenCalled();
  });

  it('throws on public network when FEE_PAYER_SECRET_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    vi.resetModules();
    const { getFeePayerKeypair } = await import('./fee-payer');
    expect(() => getFeePayerKeypair()).toThrow(
      'FEE_PAYER_SECRET_KEY is required on the Stellar public network'
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
    vi.resetModules();
    const { fundAccount } = await import('./fee-payer');
    await fundAccount(PUBLIC_KEY);
    expect(requestAirdropSpy).not.toHaveBeenCalled();
  });

  it('calls requestAirdrop on testnet', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    vi.resetModules();
    const { fundAccount } = await import('./fee-payer');
    await fundAccount(PUBLIC_KEY);
    expect(requestAirdropSpy).toHaveBeenCalledWith(PUBLIC_KEY);
  });
});
