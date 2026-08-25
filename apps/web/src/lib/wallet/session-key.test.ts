import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  generateSessionKeypair,
  encryptSessionKey,
  decryptSessionKey,
  saveSessionKey,
  loadSessionKey,
  clearSessionKey,
  hasUsableSessionKey,
} from './session-key';

describe('session-key', () => {
  beforeEach(async () => {
    await clearSessionKey();
  });

  afterEach(async () => {
    await clearSessionKey();
  });

  describe('generateSessionKeypair', () => {
    it('generates a valid Stellar keypair', async () => {
      const kp = await generateSessionKeypair();
      expect(kp.publicKey).toMatch(/^G[A-Z2-7]{55}$/);
      expect(kp.secret).toMatch(/^S[A-Z2-7]{55}$/);
    });

    it('generates unique keypairs each time', async () => {
      const a = await generateSessionKeypair();
      const b = await generateSessionKeypair();
      expect(a.publicKey).not.toBe(b.publicKey);
      expect(a.secret).not.toBe(b.secret);
    });
  });

  describe('encryptSessionKey / decryptSessionKey', () => {
    it('round-trips with correct PIN', async () => {
      const { secret } = await generateSessionKeypair();
      const encrypted = await encryptSessionKey(secret, '123456');
      const decrypted = await decryptSessionKey(encrypted, '123456');
      expect(decrypted).toBe(secret);
    });

    it('throws with wrong PIN', async () => {
      const { secret } = await generateSessionKeypair();
      const encrypted = await encryptSessionKey(secret, '123456');
      await expect(decryptSessionKey(encrypted, '000000')).rejects.toThrow('Invalid PIN');
    });

    it('stores correct metadata', async () => {
      const { secret, publicKey } = await generateSessionKeypair();
      const before = Date.now();
      const encrypted = await encryptSessionKey(secret, '123456');
      const after = Date.now();

      expect(encrypted.publicKey).toBe(publicKey);
      expect(encrypted.createdAt).toBeGreaterThanOrEqual(before);
      expect(encrypted.createdAt).toBeLessThanOrEqual(after);
      expect(encrypted.expiresAt).toBe(encrypted.createdAt + 24 * 60 * 60 * 1000);
    });
  });

  describe('saveSessionKey / loadSessionKey / clearSessionKey', () => {
    it('saves and loads a session key', async () => {
      const { secret } = await generateSessionKeypair();
      const encrypted = await encryptSessionKey(secret, '123456');
      await saveSessionKey(encrypted);

      const loaded = await loadSessionKey();
      expect(loaded).not.toBeNull();
      expect(loaded?.publicKey).toBe(encrypted.publicKey);
      expect(loaded?.ciphertext).toBe(encrypted.ciphertext);
    });

    it('returns null when no key is stored', async () => {
      const loaded = await loadSessionKey();
      expect(loaded).toBeNull();
    });

    it('clears the stored key', async () => {
      const { secret } = await generateSessionKeypair();
      const encrypted = await encryptSessionKey(secret, '123456');
      await saveSessionKey(encrypted);
      await clearSessionKey();

      const loaded = await loadSessionKey();
      expect(loaded).toBeNull();
    });
  });

  describe('hasUsableSessionKey', () => {
    it('returns false when no key exists', async () => {
      expect(await hasUsableSessionKey()).toBe(false);
    });

    it('returns true for a fresh key', async () => {
      const { secret } = await generateSessionKeypair();
      const encrypted = await encryptSessionKey(secret, '123456');
      await saveSessionKey(encrypted);
      expect(await hasUsableSessionKey()).toBe(true);
    });

    it('returns false and deletes an expired key', async () => {
      const { secret } = await generateSessionKeypair();
      const encrypted = await encryptSessionKey(secret, '123456');
      // Fake expiry in the past
      const expired = { ...encrypted, expiresAt: Date.now() - 1000 };
      await saveSessionKey(expired);
      expect(await hasUsableSessionKey()).toBe(false);
      expect(await loadSessionKey()).toBeNull();
    });
  });
});
