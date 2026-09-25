import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptSecret, decryptSecret } from './claim-secrets';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const SECRET = 'deadbeef'.repeat(8);

beforeEach(() => {
  process.env.CLAIM_SECRET_ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  delete process.env.CLAIM_SECRET_ENCRYPTION_KEY;
});

function repack(
  packed: string,
  mutate: (parts: [string, string, string]) => [string, string, string]
): string {
  const [iv, tag, ciphertext] = packed.split(':');
  return mutate([iv, tag, ciphertext]).join(':');
}

function flipFirstByte(b64: string): string {
  const buf = Buffer.from(b64, 'base64');
  buf[0] ^= 0xff;
  return buf.toString('base64');
}

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a claim secret', () => {
    expect(decryptSecret(encryptSecret(SECRET))).toBe(SECRET);
  });

  it('round-trips a non-ASCII plaintext', () => {
    const plaintext = 'clé — ключ — 鍵';
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it('packs as three base64 fields separated by colons', () => {
    const parts = encryptSecret(SECRET).split(':');
    expect(parts).toHaveLength(3);
    // 16-byte IV, 16-byte GCM auth tag.
    expect(Buffer.from(parts[0], 'base64')).toHaveLength(16);
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(16);
    expect(Buffer.from(parts[2], 'base64').length).toBeGreaterThan(0);
  });

  it('produces a different ciphertext each time for the same plaintext', () => {
    const first = encryptSecret(SECRET);
    const second = encryptSecret(SECRET);
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe(SECRET);
    expect(decryptSecret(second)).toBe(SECRET);
  });
});

describe('missing CLAIM_SECRET_ENCRYPTION_KEY', () => {
  it('makes encryptSecret throw', () => {
    delete process.env.CLAIM_SECRET_ENCRYPTION_KEY;
    expect(() => encryptSecret(SECRET)).toThrow(
      'CLAIM_SECRET_ENCRYPTION_KEY is not configured'
    );
  });

  it('makes decryptSecret throw', () => {
    const packed = encryptSecret(SECRET);
    delete process.env.CLAIM_SECRET_ENCRYPTION_KEY;
    expect(() => decryptSecret(packed)).toThrow(
      'CLAIM_SECRET_ENCRYPTION_KEY is not configured'
    );
  });
});

describe('decryptSecret rejects malformed packing', () => {
  it('rejects a string with no separators', () => {
    expect(() => decryptSecret('not-packed-at-all')).toThrow(
      'Invalid ciphertext format'
    );
  });

  it('rejects a string with only two fields', () => {
    const [iv, tag] = encryptSecret(SECRET).split(':');
    expect(() => decryptSecret(`${iv}:${tag}`)).toThrow(
      'Invalid ciphertext format'
    );
  });

  it('rejects an empty field', () => {
    const packed = repack(encryptSecret(SECRET), ([iv, , ciphertext]) => [
      iv,
      '',
      ciphertext,
    ]);
    expect(() => decryptSecret(packed)).toThrow('Invalid ciphertext format');
  });

  it('rejects the empty string', () => {
    expect(() => decryptSecret('')).toThrow('Invalid ciphertext format');
  });
});

describe('decryptSecret rejects tampering', () => {
  it('rejects a tampered auth tag', () => {
    const packed = repack(encryptSecret(SECRET), ([iv, tag, ciphertext]) => [
      iv,
      flipFirstByte(tag),
      ciphertext,
    ]);
    expect(() => decryptSecret(packed)).toThrow();
  });

  it('rejects tampered ciphertext', () => {
    const packed = repack(encryptSecret(SECRET), ([iv, tag, ciphertext]) => [
      iv,
      tag,
      flipFirstByte(ciphertext),
    ]);
    expect(() => decryptSecret(packed)).toThrow();
  });

  it('rejects a tampered IV', () => {
    const packed = repack(encryptSecret(SECRET), ([iv, tag, ciphertext]) => [
      flipFirstByte(iv),
      tag,
      ciphertext,
    ]);
    expect(() => decryptSecret(packed)).toThrow();
  });

  it('rejects a ciphertext encrypted under a different key', () => {
    const packed = encryptSecret(SECRET);
    process.env.CLAIM_SECRET_ENCRYPTION_KEY = OTHER_KEY;
    expect(() => decryptSecret(packed)).toThrow();
  });
});
