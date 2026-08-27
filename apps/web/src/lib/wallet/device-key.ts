import { Keypair } from '@stellar/stellar-sdk';
import type { PasskeyKit } from 'passkey-kit';
import { Ed25519Signer, SignerKey, SignerStore } from 'passkey-kit';
import { getUsdcContractId, getXlmContractId } from './assets';

export interface StoredDeviceKey {
  email: string;
  publicKey: string;
  ciphertext: string;
  iv: string;
  salt: string;
  createdAt: number;
  expiresAt: number;
}

const DB_NAME = 'pocketlet-device';
const STORE_NAME = 'device-key';
const DB_VERSION = 1;
const RECORD_ID = 'current';

const DEVICE_KEY_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

function encodeBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('base64');
}

function decodeBase64(str: string): Uint8Array {
  return Uint8Array.from(Buffer.from(str, 'base64'));
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const pinKey = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: Buffer.from(salt), iterations: 100_000, hash: 'SHA-256' },
    pinKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function generateDeviceKeypair(): Promise<{ publicKey: string; secret: string }> {
  const kp = Keypair.random();
  return { publicKey: kp.publicKey(), secret: kp.secret() };
}

export async function encryptDeviceKey(
  secret: string,
  pin: string,
  email: string
): Promise<StoredDeviceKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: Buffer.from(iv) },
    key,
    encoder.encode(secret)
  );
  const now = Date.now();
  return {
    email,
    publicKey: Keypair.fromSecret(secret).publicKey(),
    ciphertext: encodeBase64(ciphertext),
    iv: encodeBase64(iv.buffer),
    salt: encodeBase64(salt.buffer),
    createdAt: now,
    expiresAt: now + DEVICE_KEY_LIFETIME_MS,
  };
}

export async function decryptDeviceKey(stored: StoredDeviceKey, pin: string): Promise<string> {
  const salt = decodeBase64(stored.salt);
  const iv = decodeBase64(stored.iv);
  const ciphertext = decodeBase64(stored.ciphertext);
  const key = await deriveKey(pin, salt);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(iv) },
      key,
      Buffer.from(ciphertext)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('Invalid PIN');
  }
}

export async function loadDeviceKey(): Promise<StoredDeviceKey | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(RECORD_ID);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
      req.onsuccess = () => {
        const result = req.result;
        if (!result) {
          resolve(null);
          return;
        }
        resolve({
          email: result.email,
          publicKey: result.publicKey,
          ciphertext: result.ciphertext,
          iv: result.iv,
          salt: result.salt,
          createdAt: result.createdAt,
          expiresAt: result.expiresAt,
        });
      };
    });
  } catch {
    return null;
  }
}

export async function saveDeviceKey(stored: StoredDeviceKey): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put({ ...stored, id: RECORD_ID });
    req.onerror = () => reject(req.error ?? new Error('IndexedDB write failed'));
    req.onsuccess = () => resolve();
  });
}

export async function clearDeviceKey(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(RECORD_ID);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'));
      req.onsuccess = () => resolve();
    });
  } catch {
    // Best-effort cleanup
  }
}

export async function hasUsableDeviceKey(): Promise<boolean> {
  const stored = await loadDeviceKey();
  if (!stored) return false;
  if (stored.expiresAt <= Date.now()) {
    await clearDeviceKey();
    return false;
  }
  return true;
}

export async function getDeviceSigner(pin: string): Promise<Ed25519Signer> {
  const stored = await loadDeviceKey();
  if (!stored) {
    throw new Error('Device key not found');
  }
  if (stored.expiresAt <= Date.now()) {
    await clearDeviceKey();
    throw new Error('Device key expired');
  }

  const secret = await decryptDeviceKey(stored, pin);
  return Ed25519Signer.fromSecret(secret);
}

/**
 * Sign a server-issued login challenge with the device key.
 * Returns the base64-encoded signature.
 */
export async function signDeviceChallenge(pin: string, challengeBase64: string): Promise<string> {
  const stored = await loadDeviceKey();
  if (!stored) {
    throw new Error('Device key not found');
  }
  if (stored.expiresAt <= Date.now()) {
    await clearDeviceKey();
    throw new Error('Device key expired');
  }

  const secret = await decryptDeviceKey(stored, pin);
  const kp = Keypair.fromSecret(secret);
  const challenge = Buffer.from(challengeBase64, 'base64');
  const signature = kp.sign(challenge);
  return signature.toString('base64');
}

/**
 * Ensure a usable device key exists locally and on-chain.
 * If missing or expired, generates a new one, encrypts it with the PIN,
 * saves locally, and registers it on-chain as a Temporary signer.
 *
 * If `authSigner` is provided, the on-chain registration tx is signed with
 * that signer (e.g. a recovery key). Otherwise the kit's default signer
 * (passkey) is used.
 */
export async function ensureDeviceKey(
  kit: PasskeyKit,
  pin: string,
  email: string,
  authSigner?: Ed25519Signer
): Promise<void> {
  if (await hasUsableDeviceKey()) {
    const onChainValid = await verifyDeviceKeyOnChain(kit);
    if (onChainValid) {
      return;
    }
    await clearDeviceKey();
  }

  const { publicKey, secret } = await generateDeviceKeypair();
  const encrypted = await encryptDeviceKey(secret, pin, email);
  await saveDeviceKey(encrypted);

  const limits = new Map([
    [getUsdcContractId(), undefined],
    [getXlmContractId(), undefined],
  ]);

  const expirationSeconds = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;

  const addSignerTx = await kit.addEd25519(publicKey, limits, SignerStore.Temporary, expirationSeconds);
  if (authSigner) {
    await kit.sign(addSignerTx, authSigner);
  } else {
    await kit.sign(addSignerTx);
  }
  const signedXdr = addSignerTx.toXDR();

  const res = await fetch('/api/wallet/device-key/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr, publicKey }),
  });

  if (!res.ok) {
    await clearDeviceKey();
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? 'Failed to authorize device key');
  }
}

/**
 * Verify that the locally stored device key is still a registered signer on the
 * connected wallet. Returns true if it exists on-chain; false if it is missing
 * or the lookup fails.
 */
export async function verifyDeviceKeyOnChain(kit: PasskeyKit): Promise<boolean> {
  const stored = await loadDeviceKey();
  if (!stored) {
    return false;
  }
  try {
    const signerVal = await kit.getSigner(SignerKey.Ed25519(stored.publicKey));
    return signerVal !== null;
  } catch {
    return false;
  }
}
