import { describe, it, expect } from 'vitest';
import {
  normalizeUsername,
  isValidUsernameFormat,
  normalizePhone,
  isValidPhoneFormat,
  isValidAddressFormat,
  validateRecipientFormat,
} from './recipient-format';

describe('normalizeUsername', () => {
  it('trims, lowercases, and strips a leading @', () => {
    expect(normalizeUsername('  @Alice_123  ')).toBe('alice_123');
    expect(normalizeUsername('bob')).toBe('bob');
    expect(normalizeUsername('@charlie')).toBe('charlie');
  });
});

describe('isValidUsernameFormat', () => {
  it('accepts valid usernames', () => {
    expect(isValidUsernameFormat('alice')).toBe(true);
    expect(isValidUsernameFormat('Alice_123')).toBe(true);
    expect(isValidUsernameFormat('bob.test-1')).toBe(true);
  });

  it('rejects malformed usernames', () => {
    expect(isValidUsernameFormat('ab')).toBe(false); // too short
    expect(isValidUsernameFormat('a'.repeat(31))).toBe(false); // too long
    expect(isValidUsernameFormat('alice@example')).toBe(false); // @ not allowed
    expect(isValidUsernameFormat('alice space')).toBe(false);
  });
});

describe('normalizePhone', () => {
  it('normalizes phone numbers', () => {
    expect(normalizePhone('+63 912 345 6789')).toBe('+639123456789');
    expect(normalizePhone('+1-800-555-0199')).toBe('+18005550199');
    expect(normalizePhone('09123456789')).toBe('09123456789'); // no plus, digits preserved
  });
});

describe('isValidPhoneFormat', () => {
  it('accepts valid phone numbers', () => {
    expect(isValidPhoneFormat('+639123456789')).toBe(true);
    expect(isValidPhoneFormat('+18005550199')).toBe(true);
  });

  it('rejects malformed phone numbers', () => {
    expect(isValidPhoneFormat('09123456789')).toBe(false); // missing +
    expect(isValidPhoneFormat('+123')).toBe(false); // too short
    expect(isValidPhoneFormat('+1' + '0'.repeat(15))).toBe(false); // too long
    expect(isValidPhoneFormat('+abcdefghij')).toBe(false);
  });
});

describe('isValidAddressFormat', () => {
  it('accepts a valid Stellar address', () => {
    expect(isValidAddressFormat('GATVJDFPIPADU74ALX4344HEQQZ2LGMNWABPXBOWYMVXM37KMTTUALTU')).toBe(true);
  });

  it('rejects an invalid Stellar address', () => {
    expect(isValidAddressFormat('not-an-address')).toBe(false);
  });
});

describe('validateRecipientFormat', () => {
  it('returns null for a valid address, phone, or username', () => {
    expect(validateRecipientFormat('GATVJDFPIPADU74ALX4344HEQQZ2LGMNWABPXBOWYMVXM37KMTTUALTU')).toBe(null);
    expect(validateRecipientFormat('+639123456789')).toBe(null);
    expect(validateRecipientFormat('@alice')).toBe(null);
  });

  it('returns an error for empty input', () => {
    expect(validateRecipientFormat('   ')).toBe('Recipient is required');
  });

  it('returns an error for input matching no supported format', () => {
    expect(validateRecipientFormat('hello world')).toBe(
      'Enter a valid username, phone number, or Stellar address.'
    );
    expect(validateRecipientFormat('alice@example.com')).toBe(
      'Enter a valid username, phone number, or Stellar address.'
    );
  });
});
