import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKeyStorage, migratePlaintextKey } from './keys';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-keys-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
  delete process.env.OWNER_KEY_MASTER_KEY;
  delete process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
  delete process.env.OWNER_KEY_MASTER_KEY;
});

describe('key storage', () => {
  it('stores and retrieves a secret', () => {
    const storage = createKeyStorage();
    storage.store('alice@example.com', 'SSECRET');
    expect(storage.retrieve('alice@example.com')).toBe('SSECRET');
  });

  it('reports whether a key exists', () => {
    const storage = createKeyStorage();
    expect(storage.has('bob@example.com')).toBe(false);
    storage.store('bob@example.com', 'SSECRET');
    expect(storage.has('bob@example.com')).toBe(true);
    expect(storage.has('BOB@EXAMPLE.COM')).toBe(true);
  });

  it('removes a stored key', () => {
    const storage = createKeyStorage();
    storage.store('carol@example.com', 'SSECRET');
    storage.remove('carol@example.com');
    expect(storage.has('carol@example.com')).toBe(false);
    expect(storage.retrieve('carol@example.com')).toBeUndefined();
  });

  it('does not store plaintext secrets in owner_keys.json', () => {
    const storage = createKeyStorage();
    storage.store('dave@example.com', 'SPLAINTEXT');
    const raw = readFileSync(join(dataDir, 'owner_keys.json'), 'utf-8');
    expect(raw).not.toContain('SPLAINTEXT');
    expect(storage.retrieve('dave@example.com')).toBe('SPLAINTEXT');
  });

  it('keeps different users secrets isolated', () => {
    const storage = createKeyStorage();
    storage.store('alice@example.com', 'SALICE');
    storage.store('bob@example.com', 'SBOB');
    expect(storage.retrieve('alice@example.com')).toBe('SALICE');
    expect(storage.retrieve('bob@example.com')).toBe('SBOB');
  });

  it('returns undefined for unknown users', () => {
    const storage = createKeyStorage();
    expect(storage.retrieve('unknown@example.com')).toBeUndefined();
  });

  it('generates a testnet master key file when env var is not set', () => {
    const storage = createKeyStorage();
    storage.store('eve@example.com', 'SEVE');
    const masterKeyFile = join(dataDir, 'owner_key_master');
    expect(existsSync(masterKeyFile)).toBe(true);
    expect(storage.retrieve('eve@example.com')).toBe('SEVE');
  });

  it('uses OWNER_KEY_MASTER_KEY from env when set', () => {
    process.env.OWNER_KEY_MASTER_KEY =
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
    const storage = createKeyStorage();
    storage.store('frank@example.com', 'SFRANK');
    expect(existsSync(join(dataDir, 'owner_key_master'))).toBe(false);
    expect(storage.retrieve('frank@example.com')).toBe('SFRANK');
  });

  it('migrates a plaintext key into the encrypted store', () => {
    const storage = createKeyStorage();
    expect(
      migratePlaintextKey({ email: 'grace@example.com', ownerSecretKey: 'SGRACE' })
    ).toBe(true);
    expect(storage.retrieve('grace@example.com')).toBe('SGRACE');
    expect(migratePlaintextKey({ email: 'grace@example.com' })).toBe(false);
  });
});
