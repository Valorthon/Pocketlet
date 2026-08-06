import type { User } from './store';
import { keyStorage } from '../wallet/keys';

export const RECOVERY_CODE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
export const RECOVERY_MAX_ATTEMPTS = 3;
export const RECOVERY_LOCKOUT_MS = 60 * 60 * 1000; // 1 hour
export const RECOVERY_MIN_RETRY_MS = 60 * 1000; // 1 minute
export const RECOVERY_MAX_INITIATES_PER_HOUR = 5;
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
  return Math.floor(100000 + Math.random() * 900000).toString();
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
  return new Date(verifiedAt).getTime() + getRecoveryWaitingPeriodMs() <= now;
}

export function getReadyAfter(verifiedAt: string): Date {
  return new Date(new Date(verifiedAt).getTime() + getRecoveryWaitingPeriodMs());
}

export function isEligibleForRecovery(user: User | undefined): boolean {
  if (!user) {
    return false;
  }
  return (
    user.emailVerified === true &&
    Boolean(user.credential) &&
    Boolean(user.contractId) &&
    keyStorage.has(user.email)
  );
}

export function isRecoveryInitiationRateLimited(user: User | undefined): boolean {
  if (!user?.recoveryInitiatedAt) {
    return false;
  }
  const lastInitiation = new Date(user.recoveryInitiatedAt).getTime();
  if (Date.now() - lastInitiation < RECOVERY_MIN_RETRY_MS) {
    return true;
  }
  return false;
}

export function countRecentInitiations(
  user: User | undefined,
  windowMs = 60 * 60 * 1000
): number {
  if (!user?.recoveryInitiatedAt) {
    return 0;
  }
  const cutoff = Date.now() - windowMs;
  return new Date(user.recoveryInitiatedAt).getTime() > cutoff ? 1 : 0;
}

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
