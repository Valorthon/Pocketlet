import { describe, it, expect } from 'vitest';
import {
  generateRecoveryPhrase,
  isValidRecoveryPhrase,
  deriveRecoveryKeypair,
  getRecoveryPublicKey,
  splitRecoveryPhrase,
  RECOVERY_PHRASE_WORD_COUNT,
} from './recovery';

describe('recovery phrase utilities', () => {
  it('generates a 12-word phrase', () => {
    const phrase = generateRecoveryPhrase();
    const words = splitRecoveryPhrase(phrase);
    expect(words).toHaveLength(RECOVERY_PHRASE_WORD_COUNT);
    expect(isValidRecoveryPhrase(phrase)).toBe(true);
  });

  it('generates different phrases on successive calls', () => {
    const a = generateRecoveryPhrase();
    const b = generateRecoveryPhrase();
    expect(a).not.toBe(b);
  });

  it('rejects an invalid phrase', () => {
    expect(isValidRecoveryPhrase('not a valid mnemonic')).toBe(false);
  });

  it('derives a deterministic Stellar keypair from a phrase', () => {
    const phrase =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const kp1 = deriveRecoveryKeypair(phrase);
    const kp2 = deriveRecoveryKeypair(phrase);
    expect(kp1.publicKey()).toBe(kp2.publicKey());
    expect(kp1.publicKey()).toMatch(/^G[A-Z0-9]{55}$/);
  });

  it('derives the public key without exposing the secret', () => {
    const phrase = generateRecoveryPhrase();
    const publicKey = getRecoveryPublicKey(phrase);
    expect(publicKey).toMatch(/^G[A-Z0-9]{55}$/);
  });

  it('throws for an invalid phrase', () => {
    expect(() => deriveRecoveryKeypair('invalid phrase')).toThrow('Invalid recovery phrase');
  });
});
