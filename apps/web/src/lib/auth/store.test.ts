import { describe, it, expect, beforeEach } from 'vitest';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { resetDatabase } from '../db/test-setup';
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
  normalizeUsername,
  isValidUsername,
  normalizePhone,
  isValidPhone,
  getUserByUsername,
  getUserByPhone,
  setProfile,
  setWallet,
  setRecoveryPublicKey,
  markRecoveryPhraseConfirmed,
  setBackupPasskey,
  setRecoveryInitiated,
  verifyRecoveryCode,
  isRecoveryLocked,
  clearRecoveryState,
} from './store';

beforeEach(async () => {
  await resetDatabase();
});

describe('auth store', () => {
  it('creates a user with a verification code', async () => {
    const user = await createUser('Alice@Example.com', '123456');
    expect(user.email).toBe('alice@example.com');
    expect(user.emailVerified).toBe(false);
    expect(user.verificationCode).toBe('123456');

    const found = await getUserByEmail('ALICE@EXAMPLE.COM');
    expect(found).toEqual(user);
  });

  it('verifies an email', async () => {
    await createUser('test@example.com', '654321');
    const verified = await setEmailVerified('test@example.com');
    expect(verified.emailVerified).toBe(true);
    expect(verified.verificationCode).toBeUndefined();
  });

  it('stores a credential and counter', async () => {
    await createUser('u@example.com', '000000');
    const credential = {
      id: 'cred-id',
      publicKey: 'base64-pubkey',
      counter: 0,
    };
    await setCredential('u@example.com', credential);
    const updated = await updateCredentialCounter('u@example.com', 1);
    expect(updated.credential).toEqual({ ...credential, counter: 1 });
  });

  it('throws when creating a duplicate user', async () => {
    await createUser('dup@example.com', '111111');
    await expect(createUser('DUP@EXAMPLE.COM', '222222')).rejects.toThrow(
      'already registered'
    );
  });

  it('stores a PIN hash and verifies a correct PIN', async () => {
    await createUser('pin@example.com', '000000');
    await setPin('pin@example.com', '123456');
    expect(await hasPin('pin@example.com')).toBe(true);
    expect(await verifyPinForUser('pin@example.com', '123456')).toBe(true);
    expect(await verifyPinForUser('pin@example.com', '654321')).toBe(false);
  });

  it('does not store the PIN in plain text', async () => {
    await createUser('secure@example.com', '000000');
    const user = await setPin('secure@example.com', '654321');
    expect(user.pinHash).toBeDefined();
    expect(user.pinHash).not.toContain('654321');
    expect(user.pinHash).toMatch(/^[a-f0-9]{32}:[a-f0-9]{64}$/);
  });

  it('manages PIN reset codes', async () => {
    await createUser('reset@example.com', '000000');
    await setPinResetCode('reset@example.com', '987654');
    expect(await verifyPinResetCode('reset@example.com', '987654')).toBe(true);
    expect(await verifyPinResetCode('reset@example.com', '111111')).toBe(false);
    await clearPinResetCode('reset@example.com');
    expect(await verifyPinResetCode('reset@example.com', '987654')).toBe(false);
  });

  it('stores wallet info including passkey key id', async () => {
    await createUser('wallet@example.com', '000000');
    const user = await setWallet('wallet@example.com', {
      walletContractId: 'CABC',
      stellarAddress: 'CABC',
      primaryPasskeyKeyId: 'key-id',
    });
    expect(user.walletContractId).toBe('CABC');
    expect(user.stellarAddress).toBe('CABC');
    expect(user.primaryPasskeyKeyId).toBe('key-id');
  });

  it('stores recovery public key and confirmation flag', async () => {
    await createUser('recovery@example.com', '000000');
    await setRecoveryPublicKey('recovery@example.com', 'GABC');
    const user = await markRecoveryPhraseConfirmed('recovery@example.com');
    expect(user.recoveryPublicKey).toBe('GABC');
    expect(user.recoveryPhraseConfirmed).toBe(true);
  });

  it('stores backup passkey info', async () => {
    await createUser('backup@example.com', '000000');
    const credential = {
      id: 'backup-key-id',
      publicKey: 'backup-pubkey',
      counter: 0,
      transports: ['hybrid'] as AuthenticatorTransportFuture[],
    };
    const user = await setBackupPasskey('backup@example.com', { credential });
    expect(user.hasBackupPasskey).toBe(true);
    expect(user.backupCredential).toEqual(credential);
  });

  it('manages recovery state', async () => {
    await createUser('recovery@example.com', '000000');
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    const user = await setRecoveryInitiated(
      'recovery@example.com',
      '123456',
      expiresAt
    );
    expect(user.recoveryCode).toBe('123456');
    expect(user.recoveryCodeExpiresAt).toBe(expiresAt);
    expect(user.recoveryAttempts).toBe(0);

    const verified = await verifyRecoveryCode('recovery@example.com', '123456');
    expect(verified.recoveryVerifiedAt).toBeDefined();
    expect(verified.recoveryCode).toBeUndefined();

    const cleared = await clearRecoveryState('recovery@example.com');
    expect(cleared.recoveryVerifiedAt).toBeUndefined();
  });

  it('locks recovery after too many failed attempts', async () => {
    await createUser('locked@example.com', '000000');
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    await setRecoveryInitiated('locked@example.com', '123456', expiresAt);

    await expect(
      verifyRecoveryCode('locked@example.com', '000000')
    ).rejects.toThrow('Invalid recovery code');
    await expect(
      verifyRecoveryCode('locked@example.com', '000000')
    ).rejects.toThrow('Invalid recovery code');
    await expect(
      verifyRecoveryCode('locked@example.com', '000000')
    ).rejects.toThrow('Invalid recovery code');
    await expect(
      verifyRecoveryCode('locked@example.com', '000000')
    ).rejects.toThrow('Recovery is locked');
    expect(await isRecoveryLocked('locked@example.com')).toBe(true);
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

  it('looks up users by username and phone', async () => {
    await createUser('alice@example.com', '000000');
    await setProfile('alice@example.com', {
      username: 'alice',
      phone: '+639123456789',
    });

    const byUsername = await getUserByUsername('ALICE');
    expect(byUsername?.email).toBe('alice@example.com');

    const byPhone = await getUserByPhone('+63 912 345 6789');
    expect(byPhone?.email).toBe('alice@example.com');

    expect(await getUserByUsername('unknown')).toBeUndefined();
    expect(await getUserByPhone('+639000000000')).toBeUndefined();
  });

  it('stores a profile and updates updatedAt', async () => {
    await createUser('bob@example.com', '000000');
    const user = await setProfile('bob@example.com', {
      username: 'Bob_Test',
      phone: '+1-800-555-0199',
    });
    expect(user.username).toBe('bob_test');
    expect(user.phone).toBe('+18005550199');
    expect(user.updatedAt).toBeDefined();
  });

  it('allows clearing profile fields', async () => {
    await createUser('carol@example.com', '000000');
    await setProfile('carol@example.com', {
      username: 'carol',
      phone: '+639123456789',
    });
    const cleared = await setProfile('carol@example.com', {
      username: null,
      phone: '',
    });
    expect(cleared.username).toBeUndefined();
    expect(cleared.phone).toBeUndefined();
  });

  it('rejects duplicate usernames and phones from different users', async () => {
    await createUser('alice@example.com', '000000');
    await createUser('bob@example.com', '000000');
    await setProfile('alice@example.com', {
      username: 'taken',
      phone: '+639123456789',
    });

    await expect(
      setProfile('bob@example.com', { username: 'taken' })
    ).rejects.toThrow('Username already taken');
    await expect(
      setProfile('bob@example.com', { phone: '+639123456789' })
    ).rejects.toThrow('Phone number already registered');
  });

  it('allows a user to keep their own username or phone', async () => {
    await createUser('alice@example.com', '000000');
    await setProfile('alice@example.com', {
      username: 'alice',
      phone: '+639123456789',
    });
    const updated = await setProfile('alice@example.com', {
      username: 'alice',
      phone: '+639123456789',
    });
    expect(updated.username).toBe('alice');
    expect(updated.phone).toBe('+639123456789');
  });

  it('rejects invalid profile values', async () => {
    await createUser('dave@example.com', '000000');
    await expect(
      setProfile('dave@example.com', { username: 'ab' })
    ).rejects.toThrow('Username must be');
    await expect(
      setProfile('dave@example.com', { phone: '09123456789' })
    ).rejects.toThrow('Phone number must include');
  });
});
