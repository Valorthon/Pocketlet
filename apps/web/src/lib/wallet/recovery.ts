import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from 'bip39';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Number of words in the BIP39 recovery phrase.
 */
export const RECOVERY_PHRASE_WORD_COUNT = 12;

/**
 * Entropy bits for a 12-word BIP39 mnemonic.
 */
const RECOVERY_PHRASE_ENTROPY_BITS = 128;

/**
 * Stellar standard derivation path for account 0.
 * Compatible with Freighter and LOBSTR seed-phrase import.
 */
export const STELLAR_DERIVATION_PATH = "m/44'/148'/0'";

const HARDENED_OFFSET = 0x80000000;

/**
 * Generate a new 12-word BIP39 recovery phrase.
 */
export function generateRecoveryPhrase(): string {
  return generateMnemonic(RECOVERY_PHRASE_ENTROPY_BITS);
}

/**
 * Validate that a string is a valid BIP39 mnemonic.
 */
export function isValidRecoveryPhrase(phrase: string): boolean {
  return validateMnemonic(phrase.trim());
}

function ser32(index: number): Uint8Array {
  const buffer = new Uint8Array(4);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, index, false); // big-endian
  return buffer;
}

function deriveChild(
  key: Uint8Array,
  chainCode: Uint8Array,
  index: number
): { key: Uint8Array; chainCode: Uint8Array } {
  const data = new Uint8Array(1 + 32 + 4);
  data.set([0x00], 0);
  data.set(key, 1);
  data.set(ser32(index), 33);

  const hash = hmac(sha512, chainCode, data);
  return {
    key: hash.slice(0, 32),
    chainCode: hash.slice(32, 64),
  };
}

/**
 * Derive the master ed25519 key from a BIP39 seed.
 *
 * Follows SEP-0005 using HMAC-SHA512 with the key "ed25519 seed".
 */
function deriveMasterKey(seed: Uint8Array): {
  key: Uint8Array;
  chainCode: Uint8Array;
} {
  const hash = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  return {
    key: hash.slice(0, 32),
    chainCode: hash.slice(32, 64),
  };
}

/**
 * Derive a Stellar Ed25519 keypair from a BIP39 mnemonic using the
 * standard Stellar path `m/44'/148'/0'`.
 *
 * The mnemonic is converted to a seed, then SEP-0005 ed25519 derivation is
 * applied. The resulting raw 32-byte seed is used to create a Stellar Keypair.
 */
export function deriveRecoveryKeypair(mnemonic: string): Keypair {
  const trimmed = mnemonic.trim();
  if (!validateMnemonic(trimmed)) {
    throw new Error('Invalid recovery phrase');
  }

  const seed = mnemonicToSeedSync(trimmed);
  let { key, chainCode } = deriveMasterKey(seed);

  // m/44'/148'/0'
  const indices = [44, 148, 0];
  for (const index of indices) {
    ({ key, chainCode } = deriveChild(key, chainCode, index + HARDENED_OFFSET));
  }

  return Keypair.fromRawEd25519Seed(Buffer.from(key));
}

/**
 * Derive the recovery public key (G...) from a BIP39 mnemonic.
 *
 * This is safe to share with the server; the mnemonic never leaves the client.
 */
export function getRecoveryPublicKey(mnemonic: string): string {
  return deriveRecoveryKeypair(mnemonic).publicKey();
}

/**
 * Split a recovery phrase into its individual words.
 */
export function splitRecoveryPhrase(phrase: string): string[] {
  return phrase.trim().split(/\s+/);
}
