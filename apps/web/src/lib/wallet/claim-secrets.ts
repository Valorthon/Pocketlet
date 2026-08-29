import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.CLAIM_SECRET_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('CLAIM_SECRET_ENCRYPTION_KEY is not configured');
  }
  return scryptSync(secret, 'pocketlet-claim-salt', KEY_LENGTH);
}

/**
 * Encrypt a plaintext claim secret for server-side storage.
 * Returns a single colon-delimited string: iv:authTag:ciphertext (all base64).
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt a claim secret stored by {@link encryptSecret}.
 */
export function decryptSecret(packed: string): string {
  const [ivB64, tagB64, ciphertextB64] = packed.split(':');
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error('Invalid ciphertext format');
  }
  const key = getEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
