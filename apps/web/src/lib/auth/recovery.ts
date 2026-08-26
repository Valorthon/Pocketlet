import { randomInt } from 'node:crypto';
import type { User } from './store';

export const RECOVERY_CODE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
export const RECOVERY_MAX_ATTEMPTS = 3;
export const RECOVERY_LOCKOUT_MS = 60 * 60 * 1000; // 1 hour
export const RECOVERY_MIN_RETRY_MS = 60 * 1000; // 1 minute
export const RECOVERY_MAX_INITIATES_PER_HOUR = 5;
export const RECOVERY_INITIATION_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_RECOVERY_WAITING_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getRecoveryWaitingPeriodMs(): number {
  const configured = process.env.RECOVERY_WAITING_PERIOD_MS;
  if (!configured) {
    return DEFAULT_RECOVERY_WAITING_PERIOD_MS;
  }
  const parsed = Number(configured);
  if (Number.isNaN(parsed) || parsed < 0) {
    return DEFAULT_RECOVERY_WAITING_PERIOD_MS;
  }
  return parsed;
}

export function generateRecoveryCode(): string {
  return randomInt(100000, 1000000).toString();
}

export function createRecoveryCodeExpiry(): string {
  return new Date(Date.now() + RECOVERY_CODE_EXPIRY_MS).toISOString();
}

export function isRecoveryCodeExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

export function isWaitingPeriodElapsed(
  verifiedAt: string,
  now = Date.now()
): boolean {
  return (
    new Date(verifiedAt).getTime() + getRecoveryWaitingPeriodMs() <= now
  );
}

export function getReadyAfter(verifiedAt: string): Date {
  return new Date(
    new Date(verifiedAt).getTime() + getRecoveryWaitingPeriodMs()
  );
}

export function isEligibleForRecovery(user: User | undefined): boolean {
  if (!user) {
    return false;
  }
  return (
    user.emailVerified === true &&
    Boolean(user.credential) &&
    Boolean(user.walletContractId) &&
    Boolean(user.recoveryPublicKey)
  );
}

export function isRecoveryInitiationRateLimited(user: User | undefined): boolean {
  if (!user?.recoveryInitiatedAt) {
    return false;
  }
  const lastInitiation = new Date(user.recoveryInitiatedAt).getTime();
  return Date.now() - lastInitiation < RECOVERY_MIN_RETRY_MS;
}

export function countRecentInitiations(
  user: User | undefined,
  windowMs = RECOVERY_INITIATION_WINDOW_MS
): number {
  const cutoff = Date.now() - windowMs;

  // Prefer the explicit initiation history introduced for hourly capping.
  if (user?.recoveryInitiationHistory && user.recoveryInitiationHistory.length > 0) {
    return user.recoveryInitiationHistory.filter(
      (timestamp) => new Date(timestamp).getTime() > cutoff
    ).length;
  }

  // Backward compatibility for user records created before the history field.
  if (user?.recoveryInitiatedAt) {
    return new Date(user.recoveryInitiatedAt).getTime() > cutoff ? 1 : 0;
  }

  return 0;
}

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
