import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const KEY_SIZE = 32;
const IV_SIZE = 16;

/**
 * Storage abstraction for wallet owner Ed25519 secret keys.
 *
 * V1 uses a software AES-256-GCM encrypted file store. The default
 * implementation keeps keys out of `users.json` and encrypts them at rest
 * with a master key. The interface is intentionally small so a future
 * HSM, KMS, or MPC-backed implementation can be dropped in without changing
 * callers.
 */
export interface KeyStorage {
  store(email: string, secret: string): void;
  retrieve(email: string): string | undefined;
  has(email: string): boolean;
  remove(email: string): void;
}

function getDataDir(): string {
  return process.env.POCKETLET_DATA_DIR ?? join(process.cwd(), '.data');
}

function getOwnerKeysFile(): string {
  return join(getDataDir(), 'owner_keys.json');
}

function getMasterKeyFile(): string {
  return join(getDataDir(), 'owner_key_master');
}

function isProductionNetwork(): boolean {
  return (
    (process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
      'Test SDF Network ; September 2015') ===
    'Public Global Stellar Network ; September 2015'
  );
}

function parseHexKey(value: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(
      'OWNER_KEY_MASTER_KEY must be a 64-character hexadecimal string representing 32 bytes.'
    );
  }
  return Buffer.from(value, 'hex');
}

/**
 * Load the AES-256 master key used to encrypt owner secrets.
 *
 * Order of precedence:
 *   1. `OWNER_KEY_MASTER_KEY` environment variable (hex, 32 bytes)
 *   2. `apps/web/.data/owner_key_master` (auto-generated once on testnet)
 *
 * On the Stellar public network, `OWNER_KEY_MASTER_KEY` is required and the
 * app will fail fast if it is missing. On testnet, a random key is generated
 * and persisted with 0o600 permissions to make local development work.
 */
function loadOrCreateMasterKey(): Buffer {
  const fromEnv = process.env.OWNER_KEY_MASTER_KEY;
  if (fromEnv && fromEnv.trim()) {
    return parseHexKey(fromEnv.trim());
  }

  if (isProductionNetwork()) {
    throw new Error(
      'OWNER_KEY_MASTER_KEY is required on the Stellar public network. ' +
        'Provide a 64-character hex-encoded AES-256 key via a secrets manager.'
    );
  }

  const masterKeyFile = getMasterKeyFile();
  if (existsSync(masterKeyFile)) {
    return parseHexKey(readFileSync(masterKeyFile, 'utf-8').trim());
  }

  const dataDir = getDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const key = randomBytes(KEY_SIZE);
  writeFileSync(masterKeyFile, key.toString('hex'), { mode: 0o600 });
  console.warn(
    'OWNER_KEY_MASTER_KEY is not set. A persistent testnet master key has been generated and saved to:'
  );
  console.warn(masterKeyFile);
  return key;
}

function encrypt(secret: string, key: Buffer): string {
  const iv = randomBytes(IV_SIZE);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function decrypt(token: string, key: Buffer): string {
  const parts = token.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format');
  }
  const [ivB64, tagB64, ciphertextB64] = parts;
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error('Invalid encrypted secret format');
  }
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ciphertext = Buffer.from(ciphertextB64, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf-8');
}

function loadOwnerKeys(): Record<string, string> {
  const file = getOwnerKeysFile();
  if (!existsSync(file)) {
    return {};
  }
  const raw = readFileSync(file, 'utf-8');
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveOwnerKeys(keys: Record<string, string>): void {
  const dataDir = getDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  writeFileSync(getOwnerKeysFile(), JSON.stringify(keys, null, 2));
  chmodSync(getOwnerKeysFile(), 0o600);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function storeOwnerSecret(email: string, secret: string): void {
  const masterKey = loadOrCreateMasterKey();
  const keys = loadOwnerKeys();
  keys[normalizeEmail(email)] = encrypt(secret, masterKey);
  saveOwnerKeys(keys);
}

function retrieveOwnerSecret(email: string): string | undefined {
  const masterKey = loadOrCreateMasterKey();
  const keys = loadOwnerKeys();
  const encrypted = keys[normalizeEmail(email)];
  if (!encrypted) {
    return undefined;
  }
  return decrypt(encrypted, masterKey);
}

function hasOwnerSecret(email: string): boolean {
  return Boolean(loadOwnerKeys()[normalizeEmail(email)]);
}

function removeOwnerSecret(email: string): void {
  const keys = loadOwnerKeys();
  delete keys[normalizeEmail(email)];
  saveOwnerKeys(keys);
}

export function createKeyStorage(): KeyStorage {
  return {
    store: storeOwnerSecret,
    retrieve: retrieveOwnerSecret,
    has: hasOwnerSecret,
    remove: removeOwnerSecret,
  };
}

export const keyStorage: KeyStorage = createKeyStorage();

export interface PlaintextKeyMigration {
  email: string;
  ownerSecretKey?: string;
}

/**
 * Migrate a plaintext owner secret into the encrypted key store.
 *
 * Returns `true` when a secret was migrated, `false` when there was nothing
 * to migrate. This is used to move existing V1 keys out of `users.json`
 * without requiring a manual migration script.
 */
export function migratePlaintextKey(input: PlaintextKeyMigration): boolean {
  if (!input.ownerSecretKey) {
    return false;
  }
  storeOwnerSecret(input.email, input.ownerSecretKey);
  return true;
}
