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

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pocketlet-fee-payer-test-'));
    process.env.POCKETLET_DATA_DIR = tempDir;
    originalPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
    originalSecret = process.env.FEE_PAYER_SECRET_KEY;
    delete process.env.FEE_PAYER_SECRET_KEY;
  });

  afterEach(() => {
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
  let getAccountSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
    requestAirdropSpy = vi
      .spyOn(rpc.Server.prototype, 'requestAirdrop')
      .mockResolvedValue(new Account(PUBLIC_KEY, '0'));
    // Default: account does not exist yet.
    getAccountSpy = vi
      .spyOn(rpc.Server.prototype, 'getAccount')
      .mockRejectedValue(new Error('Account not found'));
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    requestAirdropSpy.mockRestore();
    getAccountSpy.mockRestore();
    errorSpy.mockRestore();
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
    expect(getAccountSpy).not.toHaveBeenCalled();
  });

  it('calls requestAirdrop on testnet when the account does not exist', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    vi.resetModules();
    const { fundAccount } = await import('./fee-payer');
    await fundAccount(PUBLIC_KEY);
    expect(getAccountSpy).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(requestAirdropSpy).toHaveBeenCalledWith(PUBLIC_KEY);
  });

  it('does not call requestAirdrop when the account already exists', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    getAccountSpy.mockResolvedValue(new Account(PUBLIC_KEY, '0'));
    vi.resetModules();
    const { fundAccount } = await import('./fee-payer');
    await fundAccount(PUBLIC_KEY);
    expect(getAccountSpy).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(requestAirdropSpy).not.toHaveBeenCalled();
  });

  it('ignores already-funded Friendbot errors when the account exists after the error', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    requestAirdropSpy.mockRejectedValue(
      new Error('No account created in transaction')
    );
    // Account was actually created despite the parsing error.
    getAccountSpy.mockRejectedValueOnce(new Error('Account not found'));
    getAccountSpy.mockResolvedValueOnce(new Account(PUBLIC_KEY, '0'));
    vi.resetModules();
    const { fundAccount } = await import('./fee-payer');
    await expect(fundAccount(PUBLIC_KEY)).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('ignores textual already-funded Friendbot errors', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    requestAirdropSpy.mockRejectedValue(
      new Error('account already funded by friendbot')
    );
    vi.resetModules();
    const { fundAccount } = await import('./fee-payer');
    await expect(fundAccount(PUBLIC_KEY)).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs real Friendbot failures', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    requestAirdropSpy.mockRejectedValue(new Error('friendbot unreachable'));
    vi.resetModules();
    const { fundAccount } = await import('./fee-payer');
    await expect(fundAccount(PUBLIC_KEY)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      'Friendbot funding attempt failed:',
      'friendbot unreachable'
    );
  });
});
