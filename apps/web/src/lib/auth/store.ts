import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { hashPin, verifyPin } from './pin';

export interface Credential {
  id: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
}

export interface User {
  email: string;
  emailVerified: boolean;
  verificationCode?: string;
  pendingChallenge?: string;
  credential?: Credential;

  // Passkey smart wallet
  walletContractId?: string;
  stellarAddress?: string;
  primaryPasskeyKeyId?: string;

  // Recovery phrase + optional backup passkey
  recoveryPublicKey?: string;
  recoveryPhraseConfirmed?: boolean;
  hasBackupPasskey?: boolean;
  backupCredential?: Credential;

  pinHash?: string;
  pinResetCode?: string;

  // Lost-passkey recovery state
  recoveryInitiatedAt?: string;
  recoveryCode?: string;
  recoveryCodeExpiresAt?: string;
  recoveryVerifiedAt?: string;
  recoveryAttempts?: number;
  recoveryLockedUntil?: string;

  createdAt: string;
  updatedAt?: string;
  username?: string;
  phone?: string;
}

function getDataDir(): string {
  return process.env.POCKETLET_DATA_DIR ?? join(process.cwd(), '.data');
}

function getUsersFile(): string {
  return join(getDataDir(), 'users.json');
}

function loadUsers(): Record<string, User> {
  const file = getUsersFile();
  if (!existsSync(file)) {
    return {};
  }
  const raw = readFileSync(file, 'utf-8');
  let users: Record<string, User>;
  try {
    users = JSON.parse(raw) as Record<string, User>;
  } catch {
    return {};
  }

  return users;
}

function saveUsers(users: Record<string, User>): void {
  const dir = getDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getUsersFile(), JSON.stringify(users, null, 2));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/^@/, '');
}

export function isValidUsername(username: string): boolean {
  const normalized = normalizeUsername(username);
  if (normalized.length < 3 || normalized.length > 30) {
    return false;
  }
  return /^[a-z0-9_.-]+$/.test(normalized);
}

export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

export function isValidPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  if (!normalized.startsWith('+')) {
    return false;
  }
  const digits = normalized.slice(1);
  if (digits.length < 10 || digits.length > 15) {
    return false;
  }
  return /^\d+$/.test(digits);
}

export function getUserByEmail(email: string): User | undefined {
  const users = loadUsers();
  return users[normalizeEmail(email)];
}

export function getUserByUsername(username: string): User | undefined {
  const normalized = normalizeUsername(username);
  const users = loadUsers();
  return Object.values(users).find((user) => user.username === normalized);
}

export function getUserByPhone(phone: string): User | undefined {
  const normalized = normalizePhone(phone);
  const users = loadUsers();
  return Object.values(users).find((user) => user.phone === normalized);
}

export interface ProfileUpdate {
  username?: string | null;
  phone?: string | null;
}

export function setProfile(email: string, profile: ProfileUpdate): User {
  const users = loadUsers();
  const normalizedEmail = normalizeEmail(email);
  const user = users[normalizedEmail];
  if (!user) {
    throw new Error('User not found');
  }

  const { username, phone } = profile;

  if (username !== undefined) {
    if (username === null || username.trim() === '') {
      delete user.username;
    } else {
      if (!isValidUsername(username)) {
        throw new Error(
          'Username must be 3-30 characters and can only contain letters, numbers, underscores, periods, and hyphens'
        );
      }
      const normalizedUsername = normalizeUsername(username);
      const existing = getUserByUsername(normalizedUsername);
      if (existing && normalizeEmail(existing.email) !== normalizedEmail) {
        throw new Error('Username already taken');
      }
      user.username = normalizedUsername;
    }
  }

  if (phone !== undefined) {
    if (phone === null || phone.trim() === '') {
      delete user.phone;
    } else {
      if (!isValidPhone(phone)) {
        throw new Error('Phone number must include a country code starting with + and 10-15 digits');
      }
      const normalizedPhone = normalizePhone(phone);
      const existing = getUserByPhone(normalizedPhone);
      if (existing && normalizeEmail(existing.email) !== normalizedEmail) {
        throw new Error('Phone number already registered');
      }
      user.phone = normalizedPhone;
    }
  }

  user.updatedAt = new Date().toISOString();
  saveUsers(users);
  return user;
}

export function createUser(email: string, verificationCode: string): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  if (users[normalized]) {
    throw new Error('Email already registered');
  }
  const user: User = {
    email: normalized,
    emailVerified: false,
    verificationCode,
    createdAt: new Date().toISOString(),
  };
  users[normalized] = user;
  saveUsers(users);
  return user;
}

export function setEmailVerified(email: string): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user) {
    throw new Error('User not found');
  }
  user.emailVerified = true;
  delete user.verificationCode;
  saveUsers(users);
  return user;
}

export function setPendingChallenge(email: string, challenge: string): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user) {
    throw new Error('User not found');
  }
  user.pendingChallenge = challenge;
  saveUsers(users);
  return user;
}

export function setCredential(email: string, credential: Credential): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user) {
    throw new Error('User not found');
  }
  user.credential = credential;
  delete user.pendingChallenge;
  saveUsers(users);
  return user;
}

export interface WalletInfo {
  walletContractId: string;
  stellarAddress: string;
  primaryPasskeyKeyId: string;
}

export function setWallet(email: string, wallet: WalletInfo): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user) {
    throw new Error('User not found');
  }
  user.walletContractId = wallet.walletContractId;
  user.stellarAddress = wallet.stellarAddress;
  user.primaryPasskeyKeyId = wallet.primaryPasskeyKeyId;
  saveUsers(users);
  return user;
}

export function setRecoveryPublicKey(email: string, publicKey: string): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user) {
    throw new Error('User not found');
  }
  user.recoveryPublicKey = publicKey;
  saveUsers(users);
  return user;
}

export function markRecoveryPhraseConfirmed(email: string): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user) {
    throw new Error('User not found');
  }
  user.recoveryPhraseConfirmed = true;
  saveUsers(users);
  return user;
}

export interface BackupPasskeyInfo {
  credential: Credential;
}

export function setBackupPasskey(email: string, info: BackupPasskeyInfo): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user) {
    throw new Error('User not found');
  }
  user.hasBackupPasskey = true;
  user.backupCredential = info.credential;
  saveUsers(users);
  return user;
}

export function updateCredentialCounter(email: string, counter: number): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user || !user.credential) {
    throw new Error('User or credential not found');
  }
  user.credential.counter = counter;
  saveUsers(users);
  return user;
}

export function updateBackupCredentialCounter(
  email: string,
  counter: number
): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user || !user.backupCredential) {
    throw new Error('User or backup credential not found');
  }
  user.backupCredential.counter = counter;
  saveUsers(users);
  return user;
}

export function setPin(email: string, pin: string): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user) {
    throw new Error('User not found');
  }
  user.pinHash = hashPin(pin);
  saveUsers(users);
  return user;
}

export function verifyPinForUser(email: string, pin: string): boolean {
  const user = getUserByEmail(email);
  if (!user || !user.pinHash) {
    return false;
  }
  return verifyPin(pin, user.pinHash);
}

export function hasPin(email: string): boolean {
  const user = getUserByEmail(email);
  return Boolean(user?.pinHash);
}

export function setPinResetCode(email: string, code: string): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user) {
    throw new Error('User not found');
  }
  user.pinResetCode = code;
  saveUsers(users);
  return user;
}

export function verifyPinResetCode(email: string, code: string): boolean {
  const user = getUserByEmail(email);
  return user?.pinResetCode === code;
}

export function clearPinResetCode(email: string): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user) {
    throw new Error('User not found');
  }
  delete user.pinResetCode;
  saveUsers(users);
  return user;
}

export function setRecoveryInitiated(
  email: string,
  code: string,
  expiresAt: string
): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user) {
    throw new Error('User not found');
  }
  user.recoveryInitiatedAt = new Date().toISOString();
  user.recoveryCode = code;
  user.recoveryCodeExpiresAt = expiresAt;
  user.recoveryAttempts = 0;
  delete user.recoveryVerifiedAt;
  saveUsers(users);
  return user;
}

export function recordRecoveryAttempt(email: string): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user) {
    throw new Error('User not found');
  }
  const attempts = (user.recoveryAttempts ?? 0) + 1;
  user.recoveryAttempts = attempts;
  if (attempts >= 3) {
    user.recoveryLockedUntil = new Date(
      Date.now() + 60 * 60 * 1000
    ).toISOString();
  }
  saveUsers(users);
  return user;
}

export function isRecoveryLocked(email: string): boolean {
  const user = getUserByEmail(email);
  if (!user?.recoveryLockedUntil) {
    return false;
  }
  return new Date(user.recoveryLockedUntil).getTime() > Date.now();
}

export function verifyRecoveryCode(email: string, code: string): User {
  const user = getUserByEmail(email);
  if (!user) {
    throw new Error('User not found');
  }
  if (isRecoveryLocked(email)) {
    throw new Error('Recovery is locked. Try again later.');
  }
  if (!user.recoveryCode || !user.recoveryCodeExpiresAt) {
    throw new Error('No active recovery request');
  }
  if (new Date(user.recoveryCodeExpiresAt).getTime() <= Date.now()) {
    recordRecoveryAttempt(email);
    throw new Error('Recovery code expired');
  }
  if (user.recoveryCode !== code) {
    recordRecoveryAttempt(email);
    throw new Error('Invalid recovery code');
  }

  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const stored = users[normalized];
  if (!stored) {
    throw new Error('User not found');
  }
  stored.recoveryVerifiedAt = new Date().toISOString();
  delete stored.recoveryCode;
  delete stored.recoveryCodeExpiresAt;
  delete stored.recoveryAttempts;
  saveUsers(users);
  return stored;
}

export function clearRecoveryState(email: string): User {
  const users = loadUsers();
  const normalized = normalizeEmail(email);
  const user = users[normalized];
  if (!user) {
    throw new Error('User not found');
  }
  delete user.recoveryInitiatedAt;
  delete user.recoveryCode;
  delete user.recoveryCodeExpiresAt;
  delete user.recoveryVerifiedAt;
  delete user.recoveryAttempts;
  delete user.recoveryLockedUntil;
  saveUsers(users);
  return user;
}


