import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { hashPin, verifyPin } from './pin';

const { users } = schema;

export interface Credential {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
}

export interface User {
  email: string;
  emailVerified: boolean;
  verificationCode?: string;
  pendingChallenge?: string;
  credential?: Credential;
  walletContractId?: string;
  stellarAddress?: string;
  primaryPasskeyKeyId?: string;
  recoveryPublicKey?: string;
  recoveryPhraseConfirmed?: boolean;
  hasBackupPasskey?: boolean;
  backupCredential?: Credential;
  pinHash?: string;
  pinResetCode?: string;
  recoveryInitiatedAt?: string;
  recoveryInitiationHistory?: string[];
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

function toCredential(
  raw: unknown
): Credential | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.publicKey !== 'string' ||
    typeof r.counter !== 'number'
  ) {
    return undefined;
  }
  const cred: Credential = {
    id: r.id,
    publicKey: r.publicKey,
    counter: r.counter,
  };
  if (Array.isArray(r.transports)) {
    cred.transports = r.transports.filter((t): t is string => typeof t === 'string');
  }
  return cred;
}

function mapUser(row: typeof schema.users.$inferSelect): User {
  return {
    email: row.email,
    emailVerified: row.emailVerified,
    verificationCode: row.verificationCode ?? undefined,
    pendingChallenge: row.pendingChallenge ?? undefined,
    credential: toCredential(row.credential),
    walletContractId: row.walletContractId ?? undefined,
    stellarAddress: row.stellarAddress ?? undefined,
    primaryPasskeyKeyId: row.primaryPasskeyKeyId ?? undefined,
    recoveryPublicKey: row.recoveryPublicKey ?? undefined,
    recoveryPhraseConfirmed: row.recoveryPhraseConfirmed ?? undefined,
    hasBackupPasskey: row.hasBackupPasskey ?? undefined,
    backupCredential: toCredential(row.backupCredential),
    pinHash: row.pinHash ?? undefined,
    pinResetCode: row.pinResetCode ?? undefined,
    recoveryInitiatedAt: row.recoveryInitiatedAt?.toISOString(),
    recoveryInitiationHistory: row.recoveryInitiationHistory ?? undefined,
    recoveryCode: row.recoveryCode ?? undefined,
    recoveryCodeExpiresAt: row.recoveryCodeExpiresAt?.toISOString(),
    recoveryVerifiedAt: row.recoveryVerifiedAt?.toISOString(),
    recoveryAttempts: row.recoveryAttempts ?? undefined,
    recoveryLockedUntil: row.recoveryLockedUntil?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
    username: row.username ?? undefined,
    phone: row.phone ?? undefined,
  };
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

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const row = await db.query.users.findFirst({
    where: eq(users.email, normalizeEmail(email)),
  });
  return row ? mapUser(row) : undefined;
}

export async function getUserByUsername(
  username: string
): Promise<User | undefined> {
  const row = await db.query.users.findFirst({
    where: eq(users.username, normalizeUsername(username)),
  });
  return row ? mapUser(row) : undefined;
}

export async function getUserByPhone(phone: string): Promise<User | undefined> {
  const row = await db.query.users.findFirst({
    where: eq(users.phone, normalizePhone(phone)),
  });
  return row ? mapUser(row) : undefined;
}

export interface ProfileUpdate {
  username?: string | null;
  phone?: string | null;
}

export async function setProfile(
  email: string,
  profile: ProfileUpdate
): Promise<User> {
  const normalizedEmail = normalizeEmail(email);
  const existing = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });
  if (!existing) {
    throw new Error('User not found');
  }

  const updates: Partial<typeof schema.users.$inferInsert> = {
    updatedAt: new Date(),
  };

  const { username, phone } = profile;

  if (username !== undefined) {
    if (username === null || username.trim() === '') {
      updates.username = null;
    } else {
      if (!isValidUsername(username)) {
        throw new Error(
          'Username must be 3-30 characters and can only contain letters, numbers, underscores, periods, and hyphens'
        );
      }
      const normalizedUsername = normalizeUsername(username);
      const other = await getUserByUsername(normalizedUsername);
      if (other && normalizeEmail(other.email) !== normalizedEmail) {
        throw new Error('Username already taken');
      }
      updates.username = normalizedUsername;
    }
  }

  if (phone !== undefined) {
    if (phone === null || phone.trim() === '') {
      updates.phone = null;
    } else {
      if (!isValidPhone(phone)) {
        throw new Error(
          'Phone number must include a country code starting with + and 10-15 digits'
        );
      }
      const normalizedPhone = normalizePhone(phone);
      const other = await getUserByPhone(normalizedPhone);
      if (other && normalizeEmail(other.email) !== normalizedEmail) {
        throw new Error('Phone number already registered');
      }
      updates.phone = normalizedPhone;
    }
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.email, normalizedEmail))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

export async function createUser(
  email: string,
  verificationCode: string
): Promise<User> {
  const normalized = normalizeEmail(email);
  const existing = await db.query.users.findFirst({
    where: eq(users.email, normalized),
  });
  if (existing) {
    throw new Error('Email already registered');
  }

  const [row] = await db
    .insert(users)
    .values({
      email: normalized,
      emailVerified: false,
      verificationCode,
    })
    .returning();

  return mapUser(row);
}

export async function setEmailVerified(email: string): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({ emailVerified: true, verificationCode: null })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

export async function setPendingChallenge(
  email: string,
  challenge: string
): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({ pendingChallenge: challenge })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

export async function setCredential(
  email: string,
  credential: Credential
): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({
      credential: {
        id: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports,
      },
      pendingChallenge: null,
    })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

export interface WalletInfo {
  walletContractId: string;
  stellarAddress: string;
  primaryPasskeyKeyId: string;
}

export async function setWallet(
  email: string,
  wallet: WalletInfo
): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({
      walletContractId: wallet.walletContractId,
      stellarAddress: wallet.stellarAddress,
      primaryPasskeyKeyId: wallet.primaryPasskeyKeyId,
    })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

export async function setRecoveryPublicKey(
  email: string,
  publicKey: string
): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({ recoveryPublicKey: publicKey })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

export async function markRecoveryPhraseConfirmed(
  email: string
): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({ recoveryPhraseConfirmed: true })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

export interface BackupPasskeyInfo {
  credential: Credential;
}

export async function setBackupPasskey(
  email: string,
  info: BackupPasskeyInfo
): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({
      hasBackupPasskey: true,
      backupCredential: {
        id: info.credential.id,
        publicKey: info.credential.publicKey,
        counter: info.credential.counter,
        transports: info.credential.transports,
      },
    })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

export async function updateCredentialCounter(
  email: string,
  counter: number
): Promise<User> {
  const normalized = normalizeEmail(email);
  const user = await getUserByEmail(normalized);
  if (!user || !user.credential) {
    throw new Error('User or credential not found');
  }

  const [updated] = await db
    .update(users)
    .set({
      credential: {
        ...user.credential,
        counter,
      },
    })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User or credential not found');
  }

  return mapUser(updated);
}

export async function updateBackupCredentialCounter(
  email: string,
  counter: number
): Promise<User> {
  const normalized = normalizeEmail(email);
  const user = await getUserByEmail(normalized);
  if (!user || !user.backupCredential) {
    throw new Error('User or backup credential not found');
  }

  const [updated] = await db
    .update(users)
    .set({
      backupCredential: {
        ...user.backupCredential,
        counter,
      },
    })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User or backup credential not found');
  }

  return mapUser(updated);
}

export async function setPin(email: string, pin: string): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({ pinHash: hashPin(pin) })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

export async function verifyPinForUser(
  email: string,
  pin: string
): Promise<boolean> {
  const user = await getUserByEmail(email);
  if (!user || !user.pinHash) {
    return false;
  }
  return verifyPin(pin, user.pinHash);
}

export async function hasPin(email: string): Promise<boolean> {
  const user = await getUserByEmail(email);
  return Boolean(user?.pinHash);
}

export interface DeviceRecord {
  id: string;
  email: string;
  devicePublicKey: string;
  deviceName?: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
}

function mapDevice(row: typeof schema.userDevices.$inferSelect): DeviceRecord {
  return {
    id: row.id,
    email: row.email,
    devicePublicKey: row.devicePublicKey,
    deviceName: row.deviceName ?? undefined,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
  };
}

export async function getDeviceByPublicKey(
  publicKey: string
): Promise<DeviceRecord | undefined> {
  const row = await db.query.userDevices.findFirst({
    where: eq(schema.userDevices.devicePublicKey, publicKey),
  });
  return row ? mapDevice(row) : undefined;
}

export async function getDevicesForUser(email: string): Promise<DeviceRecord[]> {
  const rows = await db.query.userDevices.findMany({
    where: eq(schema.userDevices.email, normalizeEmail(email)),
    orderBy: (devices, { desc }) => [desc(devices.lastUsedAt)],
  });
  return rows.map(mapDevice);
}

export async function createDevice(
  email: string,
  devicePublicKey: string,
  deviceName?: string
): Promise<DeviceRecord> {
  const normalized = normalizeEmail(email);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const result = await db
    .insert(schema.userDevices)
    .values({
      email: normalized,
      devicePublicKey,
      deviceName: deviceName ?? null,
      createdAt: now,
      expiresAt,
      lastUsedAt: now,
    })
    .onConflictDoNothing({ target: schema.userDevices.devicePublicKey })
    .returning();

  const row = result[0];
  if (row) {
    return mapDevice(row);
  }

  // Row already existed; fetch and return it
  const existing = await getDeviceByPublicKey(devicePublicKey);
  if (!existing) {
    throw new Error('Failed to create or fetch device record');
  }
  return existing;
}

export async function updateDeviceLastUsed(id: string): Promise<void> {
  await db
    .update(schema.userDevices)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.userDevices.id, id));
}

export async function removeDevice(id: string): Promise<void> {
  await db.delete(schema.userDevices).where(eq(schema.userDevices.id, id));
}

export async function removeDevicesForUser(email: string): Promise<void> {
  await db
    .delete(schema.userDevices)
    .where(eq(schema.userDevices.email, normalizeEmail(email)));
}

export async function setPinResetCode(
  email: string,
  code: string
): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({ pinResetCode: code })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

export async function verifyPinResetCode(
  email: string,
  code: string
): Promise<boolean> {
  const user = await getUserByEmail(email);
  return user?.pinResetCode === code;
}

export async function clearPinResetCode(email: string): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({ pinResetCode: null })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

const RECOVERY_INITIATION_HISTORY_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function pruneRecoveryInitiationHistory(history: string[]): string[] {
  const cutoff = new Date(
    Date.now() - RECOVERY_INITIATION_HISTORY_WINDOW_MS
  ).toISOString();
  return history.filter((timestamp) => timestamp > cutoff);
}

export async function setRecoveryInitiated(
  email: string,
  code: string,
  expiresAt: string
): Promise<User> {
  const normalized = normalizeEmail(email);
  const user = await getUserByEmail(normalized);
  if (!user) {
    throw new Error('User not found');
  }

  const now = new Date().toISOString();
  const history = [
    ...pruneRecoveryInitiationHistory(user.recoveryInitiationHistory ?? []),
    now,
  ];

  const [updated] = await db
    .update(users)
    .set({
      recoveryInitiatedAt: new Date(),
      recoveryInitiationHistory: history,
      recoveryCode: code,
      recoveryCodeExpiresAt: new Date(expiresAt),
      recoveryAttempts: 0,
      recoveryVerifiedAt: null,
    })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

export async function recordRecoveryAttempt(email: string): Promise<User> {
  const normalized = normalizeEmail(email);
  const user = await getUserByEmail(normalized);
  if (!user) {
    throw new Error('User not found');
  }

  const attempts = (user.recoveryAttempts ?? 0) + 1;
  const updates: Partial<typeof schema.users.$inferInsert> = {
    recoveryAttempts: attempts,
  };

  if (attempts >= 3) {
    updates.recoveryLockedUntil = new Date(Date.now() + 60 * 60 * 1000);
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

export async function isRecoveryLocked(email: string): Promise<boolean> {
  const user = await getUserByEmail(email);
  if (!user?.recoveryLockedUntil) {
    return false;
  }
  return new Date(user.recoveryLockedUntil).getTime() > Date.now();
}

export async function verifyRecoveryCode(
  email: string,
  code: string
): Promise<User> {
  const normalized = normalizeEmail(email);
  const user = await getUserByEmail(normalized);
  if (!user) {
    throw new Error('User not found');
  }
  if (await isRecoveryLocked(email)) {
    throw new Error('Recovery is locked. Try again later.');
  }
  if (!user.recoveryCode || !user.recoveryCodeExpiresAt) {
    throw new Error('No active recovery request');
  }
  if (new Date(user.recoveryCodeExpiresAt).getTime() <= Date.now()) {
    await recordRecoveryAttempt(email);
    throw new Error('Recovery code expired');
  }
  if (user.recoveryCode !== code) {
    await recordRecoveryAttempt(email);
    throw new Error('Invalid recovery code');
  }

  const [updated] = await db
    .update(users)
    .set({
      recoveryVerifiedAt: new Date(),
      recoveryCode: null,
      recoveryCodeExpiresAt: null,
      recoveryAttempts: null,
    })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

export async function clearRecoveryState(email: string): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({
      recoveryInitiatedAt: null,
      recoveryInitiationHistory: null,
      recoveryCode: null,
      recoveryCodeExpiresAt: null,
      recoveryVerifiedAt: null,
      recoveryAttempts: null,
      recoveryLockedUntil: null,
    })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}
