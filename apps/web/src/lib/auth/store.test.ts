import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createUser,
  getUserByEmail,
  setEmailVerified,
  setCredential,
  updateCredentialCounter,
  setPin,
  verifyPinForUser,
  hasPin,
  setPinResetCode,
  verifyPinResetCode,
  clearPinResetCode,
  setRecoveryInitiated,
  recordRecoveryAttempt,
  isRecoveryLocked,
  verifyRecoveryCode,
  isRecoveryReady,
  clearRecoveryState,
  normalizeUsername,
  isValidUsername,
  normalizePhone,
  isValidPhone,
  getUserByUsername,
  getUserByPhone,
  setProfile,
} from './store';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-store-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
});

describe('auth store', () => {
  it('creates a user with a verification code', () => {
    const user = createUser('Alice@Example.com', '123456');
    expect(user.email).toBe('alice@example.com');
    expect(user.emailVerified).toBe(false);
    expect(user.verificationCode).toBe('123456');

    const found = getUserByEmail('ALICE@EXAMPLE.COM');
    expect(found).toEqual(user);
  });

  it('verifies an email', () => {
    createUser('test@example.com', '654321');
    const verified = setEmailVerified('test@example.com');
    expect(verified.emailVerified).toBe(true);
    expect(verified.verificationCode).toBeUndefined();
  });

  it('stores a credential and counter', () => {
    createUser('u@example.com', '000000');
    const credential = {
      id: 'cred-id',
      publicKey: 'base64-pubkey',
      counter: 0,
    };
    setCredential('u@example.com', credential);
    const updated = updateCredentialCounter('u@example.com', 1);
    expect(updated.credential).toEqual({ ...credential, counter: 1 });
  });

  it('throws when creating a duplicate user', () => {
    createUser('dup@example.com', '111111');
    expect(() => createUser('DUP@EXAMPLE.COM', '222222')).toThrow('already registered');
  });

  it('stores a PIN hash and verifies a correct PIN', () => {
    createUser('pin@example.com', '000000');
    setPin('pin@example.com', '123456');
    expect(hasPin('pin@example.com')).toBe(true);
    expect(verifyPinForUser('pin@example.com', '123456')).toBe(true);
    expect(verifyPinForUser('pin@example.com', '654321')).toBe(false);
  });

  it('does not store the PIN in plain text', () => {
    createUser('secure@example.com', '000000');
    const user = setPin('secure@example.com', '654321');
    expect(user.pinHash).toBeDefined();
    expect(user.pinHash).not.toContain('654321');
    expect(user.pinHash).toMatch(/^[a-f0-9]{32}:[a-f0-9]{64}$/);
  });

  it('manages PIN reset codes', () => {
    createUser('reset@example.com', '000000');
    setPinResetCode('reset@example.com', '987654');
    expect(verifyPinResetCode('reset@example.com', '987654')).toBe(true);
    expect(verifyPinResetCode('reset@example.com', '111111')).toBe(false);
    clearPinResetCode('reset@example.com');
    expect(verifyPinResetCode('reset@example.com', '987654')).toBe(false);
  });

  it('stores a recovery request', () => {
    createUser('recover@example.com', '000000');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const user = setRecoveryInitiated('recover@example.com', '123456', expiresAt);
    expect(user.recoveryCode).toBe('123456');
    expect(user.recoveryCodeExpiresAt).toBe(expiresAt);
    expect(user.recoveryAttempts).toBe(0);
    expect(user.recoveryVerifiedAt).toBeUndefined();
  });

  it('verifies a valid recovery code', () => {
    createUser('recover@example.com', '000000');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    setRecoveryInitiated('recover@example.com', '123456', expiresAt);
    const user = verifyRecoveryCode('recover@example.com', '123456');
    expect(user.recoveryVerifiedAt).toBeDefined();
    expect(user.recoveryCode).toBeUndefined();
    expect(user.recoveryAttempts).toBeUndefined();
  });

  it('rejects an expired recovery code', () => {
    createUser('recover@example.com', '000000');
    const expiresAt = new Date(Date.now() - 1).toISOString();
    setRecoveryInitiated('recover@example.com', '123456', expiresAt);
    expect(() => verifyRecoveryCode('recover@example.com', '123456')).toThrow('expired');
  });

  it('rejects an invalid recovery code and records attempts', () => {
    createUser('recover@example.com', '000000');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    setRecoveryInitiated('recover@example.com', '123456', expiresAt);
    expect(() => verifyRecoveryCode('recover@example.com', '000000')).toThrow('Invalid');
    expect(getUserByEmail('recover@example.com')?.recoveryAttempts).toBe(1);
  });

  it('locks recovery after too many failed attempts', () => {
    createUser('recover@example.com', '000000');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    setRecoveryInitiated('recover@example.com', '123456', expiresAt);
    expect(isRecoveryLocked('recover@example.com')).toBe(false);
    recordRecoveryAttempt('recover@example.com');
    recordRecoveryAttempt('recover@example.com');
    expect(isRecoveryLocked('recover@example.com')).toBe(false);
    recordRecoveryAttempt('recover@example.com');
    expect(isRecoveryLocked('recover@example.com')).toBe(true);
    expect(() => verifyRecoveryCode('recover@example.com', '123456')).toThrow('locked');
  });

  it('reports recovery readiness based on waiting period', () => {
    createUser('recover@example.com', '000000');
    process.env.RECOVERY_WAITING_PERIOD_MS = '60000';
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    setRecoveryInitiated('recover@example.com', '123456', expiresAt);
    verifyRecoveryCode('recover@example.com', '123456');
    expect(isRecoveryReady('recover@example.com')).toBe(false);
    const later = Date.now() + 2 * 60 * 1000;
    expect(isRecoveryReady('recover@example.com', later)).toBe(true);
    delete process.env.RECOVERY_WAITING_PERIOD_MS;
  });

  it('clears recovery state', () => {
    createUser('recover@example.com', '000000');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    setRecoveryInitiated('recover@example.com', '123456', expiresAt);
    verifyRecoveryCode('recover@example.com', '123456');
    const user = clearRecoveryState('recover@example.com');
    expect(user.recoveryCode).toBeUndefined();
    expect(user.recoveryVerifiedAt).toBeUndefined();
    expect(user.recoveryInitiatedAt).toBeUndefined();
  });
});

describe('profile identifiers', () => {
  it('normalizes usernames', () => {
    expect(normalizeUsername('  @Alice_123  ')).toBe('alice_123');
    expect(normalizeUsername('bob')).toBe('bob');
    expect(normalizeUsername('@charlie')).toBe('charlie');
  });

  it('validates usernames', () => {
    expect(isValidUsername('alice')).toBe(true);
    expect(isValidUsername('Alice_123')).toBe(true);
    expect(isValidUsername('bob.test-1')).toBe(true);
    expect(isValidUsername('ab')).toBe(false); // too short
    expect(isValidUsername('a'.repeat(31))).toBe(false); // too long
    expect(isValidUsername('alice@example')).toBe(false); // @ not allowed
    expect(isValidUsername('alice space')).toBe(false);
  });

  it('normalizes phone numbers', () => {
    expect(normalizePhone('+63 912 345 6789')).toBe('+639123456789');
    expect(normalizePhone('+1-800-555-0199')).toBe('+18005550199');
    expect(normalizePhone('09123456789')).toBe('09123456789'); // no plus, digits preserved
  });

  it('validates phone numbers', () => {
    expect(isValidPhone('+639123456789')).toBe(true);
    expect(isValidPhone('+18005550199')).toBe(true);
    expect(isValidPhone('09123456789')).toBe(false); // missing +
    expect(isValidPhone('+123')).toBe(false); // too short
    expect(isValidPhone('+1' + '0'.repeat(15))).toBe(false); // too long
    expect(isValidPhone('+abcdefghij')).toBe(false);
  });

  it('looks up users by username and phone', () => {
    createUser('alice@example.com', '000000');
    setProfile('alice@example.com', { username: 'alice', phone: '+639123456789' });

    const byUsername = getUserByUsername('ALICE');
    expect(byUsername?.email).toBe('alice@example.com');

    const byPhone = getUserByPhone('+63 912 345 6789');
    expect(byPhone?.email).toBe('alice@example.com');

    expect(getUserByUsername('unknown')).toBeUndefined();
    expect(getUserByPhone('+639000000000')).toBeUndefined();
  });

  it('stores a profile and updates updatedAt', () => {
    createUser('bob@example.com', '000000');
    const user = setProfile('bob@example.com', {
      username: 'Bob_Test',
      phone: '+1-800-555-0199',
    });
    expect(user.username).toBe('bob_test');
    expect(user.phone).toBe('+18005550199');
    expect(user.updatedAt).toBeDefined();
  });

  it('allows clearing profile fields', () => {
    createUser('carol@example.com', '000000');
    setProfile('carol@example.com', { username: 'carol', phone: '+639123456789' });
    const cleared = setProfile('carol@example.com', { username: null, phone: '' });
    expect(cleared.username).toBeUndefined();
    expect(cleared.phone).toBeUndefined();
  });

  it('rejects duplicate usernames and phones from different users', () => {
    createUser('alice@example.com', '000000');
    createUser('bob@example.com', '000000');
    setProfile('alice@example.com', { username: 'taken', phone: '+639123456789' });

    expect(() => setProfile('bob@example.com', { username: 'taken' })).toThrow('Username already taken');
    expect(() => setProfile('bob@example.com', { phone: '+639123456789' })).toThrow(
      'Phone number already registered'
    );
  });

  it('allows a user to keep their own username or phone', () => {
    createUser('alice@example.com', '000000');
    setProfile('alice@example.com', { username: 'alice', phone: '+639123456789' });
    const updated = setProfile('alice@example.com', { username: 'alice', phone: '+639123456789' });
    expect(updated.username).toBe('alice');
    expect(updated.phone).toBe('+639123456789');
  });

  it('rejects invalid profile values', () => {
    createUser('dave@example.com', '000000');
    expect(() => setProfile('dave@example.com', { username: 'ab' })).toThrow('Username must be');
    expect(() => setProfile('dave@example.com', { phone: '09123456789' })).toThrow(
      'Phone number must include'
    );
  });
});
