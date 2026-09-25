import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { constantTimeEquals } from '@/lib/constant-time';
import { hashPin, verifyPin } from './pin';
import {
  VERIFICATION_CODE_MAX_ATTEMPTS,
  createVerificationCodeExpiry,
  isVerificationCodeExpired,
} from './verification-code';

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
  verificationCodeExpiresAt?: string;
  verificationCodeAttempts?: number;
  pendingChallenge?: string;
  passkeyChallenge?: string;
  passkeyChallengeExpiresAt?: Date;
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
  pinResetCodeExpiresAt?: string;
  pinResetCodeAttempts?: number;
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
    verificationCodeExpiresAt: row.verificationCodeExpiresAt?.toISOString(),
    verificationCodeAttempts: row.verificationCodeAttempts ?? undefined,
    pendingChallenge: row.pendingChallenge ?? undefined,
    passkeyChallenge: row.passkeyChallenge ?? undefined,
    passkeyChallengeExpiresAt: row.passkeyChallengeExpiresAt ?? undefined,
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
    pinResetCodeExpiresAt: row.pinResetCodeExpiresAt?.toISOString(),
    pinResetCodeAttempts: row.pinResetCodeAttempts ?? undefined,
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

/**
 * The outcome of checking a one-time code.
 *
 * Not a boolean, because the callers need to tell an expired code from a wrong
 * one from a spent attempt budget, and answering all three with 401 "invalid"
 * leaves a user who waited 20 minutes retyping a code that can never work.
 */
export type CodeCheck =
  | { ok: true }
  | { ok: false; reason: 'no-code' | 'expired' | 'invalid' | 'too-many-attempts' };

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
      verificationCodeExpiresAt: createVerificationCodeExpiry(),
      verificationCodeAttempts: 0,
    })
    .returning();

  return mapUser(row);
}

/**
 * Issue a fresh signup verification code for an existing, unverified user.
 *
 * The resend path. It exists because of issue #18: while the code came back in
 * the response there was nothing to resend, but now that it is emailed and
 * expires in 15 minutes, a user whose mail is slow, filtered or simply never
 * arrives has no other way forward — and once the attempt cap destroys a code,
 * no way at all. Resets the attempt counter along with the code, so a new code
 * always gets a full budget.
 */
export async function setVerificationCode(
  email: string,
  verificationCode: string
): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({
      verificationCode,
      verificationCodeExpiresAt: createVerificationCodeExpiry(),
      verificationCodeAttempts: 0,
    })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

/**
 * A database handle that may be the pool or an open transaction.
 *
 * Drizzle does not export the transaction type, so it is read back off
 * `db.transaction`'s own callback signature rather than re-declared.
 */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * One of the two emailed codes that share the expiry/cap/constant-time rules,
 * named by the three columns it lives in. `verifyOneTimeCode` is the rules;
 * this is the columns they apply to.
 */
interface OneTimeCodeSlot {
  codeField: 'verificationCode' | 'pinResetCode';
  expiryField: 'verificationCodeExpiresAt' | 'pinResetCodeExpiresAt';
  attemptsField: 'verificationCodeAttempts' | 'pinResetCodeAttempts';
}

const SIGNUP_CODE_SLOT: OneTimeCodeSlot = {
  codeField: 'verificationCode',
  expiryField: 'verificationCodeExpiresAt',
  attemptsField: 'verificationCodeAttempts',
};

const PIN_RESET_CODE_SLOT: OneTimeCodeSlot = {
  codeField: 'pinResetCode',
  expiryField: 'pinResetCodeExpiresAt',
  attemptsField: 'pinResetCodeAttempts',
};

/**
 * Check an emailed one-time code: expiry, attempt cap, constant-time compare.
 *
 * **The whole check runs under `SELECT … FOR UPDATE` in one transaction**, and
 * that is the point of it. It used to be a read through `getUserByEmail`, a
 * comparison, and then `attempts = (attempts ?? 0) + 1` written blindly back —
 * three steps with nothing serialising them, on an endpoint where the attacker
 * picks the concurrency. Twenty wrong guesses issued in parallel all read
 * `attempts = 0`, all wrote 1, the cap was never reached and the code was
 * never destroyed; the same twenty issued one after another killed it on the
 * fifth. `POST /api/auth/verify-email` had no rate limit at all, so the whole
 * 10^6 space was open for the code's fifteen-minute life.
 *
 * An atomic `set attempts = coalesce(attempts, 0) + 1 … returning attempts`
 * fixes the counter but not the check: the comparison happens in JavaScript,
 * because a constant-time comparison cannot be written as SQL `=`, so every
 * request that read the row before the cap landed still got its guess
 * evaluated against a live code. Only the row lock makes "five guesses" mean
 * five. The lock is held for one round trip on a low-traffic endpoint, and the
 * cost of getting this wrong is the code itself.
 *
 * Nothing inside the transaction may touch `db` — `getUserByEmail` and friends
 * take their own pool client, which would wait on a lock this transaction
 * holds. Everything below goes through `tx`.
 *
 * Exceeding the cap destroys the code rather than setting a lockout timestamp
 * the way recovery does; see `VERIFICATION_CODE_MAX_ATTEMPTS`. A success does
 * NOT clear the code — the caller's own success path does, so the two writes
 * stay in one place and a caller cannot verify without clearing.
 */
async function verifyOneTimeCode(
  email: string,
  code: string,
  slot: OneTimeCodeSlot
): Promise<CodeCheck> {
  const normalized = normalizeEmail(email);
  const cleared = {
    [slot.codeField]: null,
    [slot.expiryField]: null,
    [slot.attemptsField]: null,
  };

  return db.transaction(async (tx): Promise<CodeCheck> => {
    const [row] = await tx
      .select({
        code: users[slot.codeField],
        expiresAt: users[slot.expiryField],
        attempts: users[slot.attemptsField],
      })
      .from(users)
      .where(eq(users.email, normalized))
      .for('update');

    // A missing row answers exactly as a missing code does. Callers map both
    // to the same 401, so looking the user up separately only added a query
    // and an enumeration oracle.
    if (!row?.code || !row.expiresAt) {
      return { ok: false, reason: 'no-code' };
    }

    if (isVerificationCodeExpired(row.expiresAt)) {
      await tx.update(users).set(cleared).where(eq(users.email, normalized));
      return { ok: false, reason: 'expired' };
    }

    if (constantTimeEquals(row.code, code)) {
      return { ok: true };
    }

    const attempts = (row.attempts ?? 0) + 1;
    if (attempts >= VERIFICATION_CODE_MAX_ATTEMPTS) {
      // The budget is spent: the code stops working even for whoever knows it.
      await tx.update(users).set(cleared).where(eq(users.email, normalized));
      return { ok: false, reason: 'too-many-attempts' };
    }

    await tx
      .update(users)
      .set({ [slot.attemptsField]: attempts })
      .where(eq(users.email, normalized));

    return { ok: false, reason: 'invalid' };
  });
}

/** {@link verifyOneTimeCode} for the signup code. */
export async function verifyEmailVerificationCode(
  email: string,
  code: string
): Promise<CodeCheck> {
  return verifyOneTimeCode(email, code, SIGNUP_CODE_SLOT);
}

export async function setEmailVerified(email: string): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({
      emailVerified: true,
      verificationCode: null,
      verificationCodeExpiresAt: null,
      verificationCodeAttempts: null,
    })
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

/**
 * How long a passkey registration challenge stays usable.
 *
 * Long enough for a user to work through a biometric prompt, short enough
 * that a leaked challenge is not worth replaying.
 */
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Issue a registration challenge, replacing any outstanding one. */
export async function setPasskeyChallenge(
  email: string,
  challenge: string
): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({
      passkeyChallenge: challenge,
      passkeyChallengeExpiresAt: new Date(Date.now() + PASSKEY_CHALLENGE_TTL_MS),
    })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

/**
 * Take the outstanding registration challenge, clearing it in the same step.
 *
 * Returns null when there is none, when it has expired, or when another
 * request took it first. The clear is a compare-and-swap on the challenge
 * value rather than a read followed by a blind write, so two concurrent
 * requests cannot both consume the same challenge — which is the whole point
 * of binding the ceremony to a server nonce (issue #56).
 */
export async function takePasskeyChallenge(
  email: string
): Promise<string | null> {
  const normalized = normalizeEmail(email);
  const row = await db.query.users.findFirst({
    where: eq(users.email, normalized),
  });

  const challenge = row?.passkeyChallenge;
  const expiresAt = row?.passkeyChallengeExpiresAt;
  if (!challenge || !expiresAt || expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const [taken] = await db
    .update(users)
    .set({ passkeyChallenge: null, passkeyChallengeExpiresAt: null })
    .where(
      and(eq(users.email, normalized), eq(users.passkeyChallenge, challenge))
    )
    .returning({ email: users.email });

  return taken ? challenge : null;
}

/** Drop any outstanding login challenge. Consumed challenges must not linger. */
export async function clearPendingChallenge(email: string): Promise<void> {
  await db
    .update(users)
    .set({ pendingChallenge: null })
    .where(eq(users.email, normalizeEmail(email)));
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
    .set({
      pinResetCode: code,
      pinResetCodeExpiresAt: createVerificationCodeExpiry(),
      pinResetCodeAttempts: 0,
    })
    .where(eq(users.email, normalized))
    .returning();

  if (!updated) {
    throw new Error('User not found');
  }

  return mapUser(updated);
}

/**
 * Check a PIN reset code. The signup code's rules exactly — expiry, a capped
 * attempt budget, constant-time comparison — see
 * {@link verifyEmailVerificationCode}.
 *
 * Returned as a {@link CodeCheck} rather than the boolean this used to be: the
 * boolean could not distinguish "wrong" from "expired" from "you are out of
 * attempts", and the last of those has to be a 429 rather than another 401 or
 * the client loops forever on a code that can no longer work.
 */
export async function verifyPinResetCode(
  email: string,
  code: string
): Promise<CodeCheck> {
  return verifyOneTimeCode(email, code, PIN_RESET_CODE_SLOT);
}

export async function clearPinResetCode(email: string): Promise<User> {
  const normalized = normalizeEmail(email);
  const [updated] = await db
    .update(users)
    .set({
      pinResetCode: null,
      pinResetCodeExpiresAt: null,
      pinResetCodeAttempts: null,
    })
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

/**
 * Undo the initiation `setRecoveryInitiated` just recorded, after the code
 * could not be delivered.
 *
 * Only the history entry — the hourly `countRecentInitiations` budget — is
 * given back. The initiation has to be written before the mail is attempted
 * (the code must be readable by the time it can be in anybody's inbox), so on
 * a 502 the user has paid for something they never received: a five-minute
 * mail outage would otherwise spend all five of their hourly initiations and
 * lock them out of recovery for an hour, which is exactly the situation the
 * 502 exists to say is recoverable.
 *
 * `recoveryInitiatedAt` is deliberately left alone. That one is a 60-second
 * retry floor rather than a budget; the 502 tells the user to try again in a
 * minute, and clearing it would let a client loop on a failing provider.
 *
 * One statement. jsonb `- <int>` removes the element at that index, and the
 * entry just appended is the last one, so this removes exactly it.
 */
export async function rollbackRecoveryInitiation(email: string): Promise<void> {
  const history = users.recoveryInitiationHistory;
  await db
    .update(users)
    .set({
      recoveryInitiationHistory: sql`case when jsonb_array_length(coalesce(${history}, '[]'::jsonb)) > 0 then ${history} - (jsonb_array_length(${history}) - 1) else ${history} end`,
    })
    .where(eq(users.email, normalizeEmail(email)));
}

/**
 * Wrong recovery codes allowed before the hour-long lockout.
 *
 * Three, not the five `VERIFICATION_CODE_MAX_ATTEMPTS` allows the signup and
 * PIN reset codes: recovery re-keys the wallet, so it is the strictest flow in
 * the app. It is also the one flow that answers with a timed lockout rather
 * than by destroying the code, because there is no cheap "ask for another" —
 * re-initiating recovery restarts the whole waiting period.
 */
export const RECOVERY_MAX_ATTEMPTS = 3;

/** How long the lockout lasts once {@link RECOVERY_MAX_ATTEMPTS} is reached. */
export const RECOVERY_LOCKOUT_MS = 60 * 60 * 1000;

/**
 * Count one wrong recovery code, arming the lockout in the same statement.
 *
 * Both writes are one `UPDATE`: the counter through `coalesce(x, 0) + 1`, and
 * the lockout through a `case` over that same new value. Every `SET`
 * expression in an `UPDATE` reads the row as it was before the statement, so
 * the two `coalesce` expressions agree.
 *
 * It was previously a read-modify-write — read the count through
 * `getUserByEmail`, add one in JavaScript, write the sum back — so the
 * stricter 3-attempt cap and the hour-long lockout were both bypassable by
 * issuing the guesses in parallel: every one of them read the same stale count
 * and wrote the same number. The two verifiers above were explicitly modelled
 * on this function and inherited the flaw; all three were fixed together.
 *
 * Takes an executor so `verifyRecoveryCode` can run it on its own transaction.
 * Calling it on `db` from inside that transaction would take a second pool
 * client and wait forever on a row lock the transaction itself holds.
 */
function recordRecoveryAttemptOn(
  executor: Executor,
  normalizedEmail: string
): Promise<Array<typeof schema.users.$inferSelect>> {
  const lockedUntil = new Date(Date.now() + RECOVERY_LOCKOUT_MS);

  return executor
    .update(users)
    .set({
      recoveryAttempts: sql`coalesce(${users.recoveryAttempts}, 0) + 1`,
      recoveryLockedUntil: sql`case when coalesce(${users.recoveryAttempts}, 0) + 1 >= ${RECOVERY_MAX_ATTEMPTS} then ${lockedUntil}::timestamptz else ${users.recoveryLockedUntil} end`,
    })
    .where(eq(users.email, normalizedEmail))
    .returning();
}

/** {@link recordRecoveryAttemptOn} against the pool. */
export async function recordRecoveryAttempt(email: string): Promise<User> {
  const [updated] = await recordRecoveryAttemptOn(db, normalizeEmail(email));

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

/**
 * Spend a recovery code: lockout, expiry, attempt cap, constant-time compare.
 *
 * Under `SELECT … FOR UPDATE` in one transaction, for the reason spelled out
 * on {@link verifyOneTimeCode}: the comparison happens in JavaScript, so an
 * atomic counter alone still lets every guess that read the row before the cap
 * landed be evaluated against a live code. Recovery re-keys the wallet and has
 * the strictest budget in the app — three guesses — so it is the last place
 * that should mean "three, unless you ask in parallel".
 *
 * The failure paths therefore cannot `throw` from inside the callback: that
 * would roll the transaction back and discard the attempt that was just
 * counted, handing an attacker unlimited free guesses. The outcome is returned
 * and the error raised outside, so the write commits.
 *
 * Nothing in the callback may touch `db`; see {@link recordRecoveryAttemptOn}.
 */
export async function verifyRecoveryCode(
  email: string,
  code: string
): Promise<User> {
  const normalized = normalizeEmail(email);

  type Outcome = { ok: true; user: User } | { ok: false; error: string };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [row] = await tx
      .select()
      .from(users)
      .where(eq(users.email, normalized))
      .for('update');

    if (!row) {
      return { ok: false, error: 'User not found' };
    }
    if (
      row.recoveryLockedUntil &&
      row.recoveryLockedUntil.getTime() > Date.now()
    ) {
      return { ok: false, error: 'Recovery is locked. Try again later.' };
    }
    if (!row.recoveryCode || !row.recoveryCodeExpiresAt) {
      return { ok: false, error: 'No active recovery request' };
    }

    if (row.recoveryCodeExpiresAt.getTime() <= Date.now()) {
      await recordRecoveryAttemptOn(tx, normalized);
      return { ok: false, error: 'Recovery code expired' };
    }

    // `constantTimeEquals`, not `!==`. Recovery is the highest-stakes code in
    // the app and was the last one still compared with a short-circuiting
    // operator; there is one implementation of that comparison on purpose.
    if (!constantTimeEquals(row.recoveryCode, code)) {
      await recordRecoveryAttemptOn(tx, normalized);
      return { ok: false, error: 'Invalid recovery code' };
    }

    const [updated] = await tx
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
      return { ok: false, error: 'User not found' };
    }

    return { ok: true, user: mapUser(updated) };
  });

  if (!outcome.ok) {
    throw new Error(outcome.error);
  }

  return outcome.user;
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
