import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateRecoveryCode,
  createRecoveryCodeExpiry,
  isRecoveryCodeExpired,
  getRecoveryWaitingPeriodMs,
  isWaitingPeriodElapsed,
  getReadyAfter,
  isEligibleForRecovery,
  isRecoveryInitiationRateLimited,
  countRecentInitiations,
  isValidEmail,
  DEFAULT_RECOVERY_WAITING_PERIOD_MS,
} from './recovery';
import type { User } from './store';

let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.RECOVERY_WAITING_PERIOD_MS;
  delete process.env.RECOVERY_WAITING_PERIOD_MS;
});

afterEach(() => {
  process.env.RECOVERY_WAITING_PERIOD_MS = originalEnv;
});

describe('recovery helpers', () => {
  it('generates a 6-digit recovery code', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('creates an expiry in the future', () => {
    const expiresAt = createRecoveryCodeExpiry();
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('detects expired codes', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isRecoveryCodeExpired(past)).toBe(true);

    const future = new Date(Date.now() + 60000).toISOString();
    expect(isRecoveryCodeExpired(future)).toBe(false);
  });

  it('reads the configured waiting period', () => {
    process.env.RECOVERY_WAITING_PERIOD_MS = '60000';
    expect(getRecoveryWaitingPeriodMs()).toBe(60000);
  });

  it('falls back to the default waiting period when env is invalid', () => {
    process.env.RECOVERY_WAITING_PERIOD_MS = 'not-a-number';
    expect(getRecoveryWaitingPeriodMs()).toBe(DEFAULT_RECOVERY_WAITING_PERIOD_MS);
  });

  it('checks whether the waiting period elapsed', () => {
    process.env.RECOVERY_WAITING_PERIOD_MS = '1000';
    const verifiedAt = new Date(Date.now() - 2000).toISOString();
    expect(isWaitingPeriodElapsed(verifiedAt)).toBe(true);

    const recent = new Date().toISOString();
    expect(isWaitingPeriodElapsed(recent)).toBe(false);
  });

  it('computes the ready-after timestamp', () => {
    process.env.RECOVERY_WAITING_PERIOD_MS = '1000';
    const verifiedAt = new Date(Date.now() - 500).toISOString();
    const readyAfter = getReadyAfter(verifiedAt);
    expect(readyAfter.getTime()).toBe(new Date(verifiedAt).getTime() + 1000);
  });

  it('determines recovery eligibility', () => {
    const base: User = {
      email: 'test@example.com',
      emailVerified: true,
      createdAt: new Date().toISOString(),
    };
    expect(
      isEligibleForRecovery({
        ...base,
        credential: { id: 'id', publicKey: 'pk', counter: 0 },
        walletContractId: 'CABC',
        recoveryPublicKey: 'GABC',
      })
    ).toBe(true);

    expect(isEligibleForRecovery({ ...base, emailVerified: false })).toBe(false);
    expect(isEligibleForRecovery(base)).toBe(false);
  });

  it('rate-limits rapid initiations', () => {
    const user: User = {
      email: 'test@example.com',
      emailVerified: true,
      createdAt: new Date().toISOString(),
      recoveryInitiatedAt: new Date().toISOString(),
    };
    expect(isRecoveryInitiationRateLimited(user)).toBe(true);

    const old: User = {
      ...user,
      recoveryInitiatedAt: new Date(Date.now() - 120000).toISOString(),
    };
    expect(isRecoveryInitiationRateLimited(old)).toBe(false);
  });

  it('counts recent initiations within the window', () => {
    const user: User = {
      email: 'test@example.com',
      emailVerified: true,
      createdAt: new Date().toISOString(),
      recoveryInitiatedAt: new Date().toISOString(),
    };
    expect(countRecentInitiations(user)).toBe(1);

    const old: User = {
      ...user,
      recoveryInitiatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    };
    expect(countRecentInitiations(old)).toBe(0);
  });

  it('validates email addresses', () => {
    expect(isValidEmail('alice@example.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail(123)).toBe(false);
  });
});
