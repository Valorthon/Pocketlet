import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getRecoveryWaitingPeriodMs,
  DEFAULT_RECOVERY_WAITING_PERIOD_MS,
  generateRecoveryCode,
  createRecoveryCodeExpiry,
  isRecoveryCodeExpired,
  isWaitingPeriodElapsed,
  getReadyAfter,
  isEligibleForRecovery,
  isRecoveryInitiationRateLimited,
  countRecentInitiations,
  isValidEmail,
} from './recovery';
import { keyStorage } from '../wallet/keys';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;

describe('recovery helpers', () => {
  beforeEach(() => {
    delete process.env.RECOVERY_WAITING_PERIOD_MS;
    dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-recovery-'));
    process.env.POCKETLET_DATA_DIR = dataDir;
    delete process.env.OWNER_KEY_MASTER_KEY;
  });

  afterEach(() => {
    delete process.env.RECOVERY_WAITING_PERIOD_MS;
    delete process.env.POCKETLET_DATA_DIR;
    delete process.env.OWNER_KEY_MASTER_KEY;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('defaults the waiting period to 24 hours', () => {
    expect(getRecoveryWaitingPeriodMs()).toBe(DEFAULT_RECOVERY_WAITING_PERIOD_MS);
  });

  it('reads the waiting period from env', () => {
    process.env.RECOVERY_WAITING_PERIOD_MS = '60000';
    expect(getRecoveryWaitingPeriodMs()).toBe(60000);
  });

  it('falls back to default for invalid env value', () => {
    process.env.RECOVERY_WAITING_PERIOD_MS = 'not-a-number';
    expect(getRecoveryWaitingPeriodMs()).toBe(DEFAULT_RECOVERY_WAITING_PERIOD_MS);
  });

  it('generates a 6-digit recovery code', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('creates an expiry roughly 15 minutes in the future', () => {
    const before = Date.now();
    const expiry = createRecoveryCodeExpiry();
    const after = Date.now();
    const expiryMs = new Date(expiry).getTime();
    expect(expiryMs).toBeGreaterThanOrEqual(before + 14 * 60 * 1000);
    expect(expiryMs).toBeLessThanOrEqual(after + 16 * 60 * 1000);
  });

  it('detects expired and non-expired codes', () => {
    expect(isRecoveryCodeExpired(new Date(Date.now() - 1).toISOString())).toBe(true);
    expect(isRecoveryCodeExpired(new Date(Date.now() + 60 * 1000).toISOString())).toBe(
      false
    );
  });

  it('checks whether the waiting period has elapsed', () => {
    process.env.RECOVERY_WAITING_PERIOD_MS = '60000';
    const verifiedAt = new Date().toISOString();
    expect(isWaitingPeriodElapsed(verifiedAt)).toBe(false);
    expect(isWaitingPeriodElapsed(verifiedAt, Date.now() + 2 * 60 * 1000)).toBe(true);
  });

  it('computes the ready-after timestamp', () => {
    process.env.RECOVERY_WAITING_PERIOD_MS = '60000';
    const verifiedAt = new Date().toISOString();
    const readyAfter = getReadyAfter(verifiedAt);
    expect(readyAfter.getTime()).toBe(
      new Date(verifiedAt).getTime() + 60000
    );
  });

  it('determines eligibility for recovery', () => {
    expect(isEligibleForRecovery(undefined)).toBe(false);
    expect(isEligibleForRecovery({ email: 'a@b.com', emailVerified: false, createdAt: '' })).toBe(
      false
    );
    keyStorage.store('recoverable@example.com', 'S123');
    expect(
      isEligibleForRecovery({
        email: 'recoverable@example.com',
        emailVerified: true,
        credential: { id: 'id', publicKey: 'pk', counter: 0 },
        contractId: 'C123',
        createdAt: '',
      })
    ).toBe(true);
  });

  it('rate-limits rapid recovery initiations', () => {
    expect(isRecoveryInitiationRateLimited(undefined)).toBe(false);
    const user = {
      email: 'a@b.com',
      emailVerified: true,
      createdAt: '',
      recoveryInitiatedAt: new Date().toISOString(),
    };
    expect(isRecoveryInitiationRateLimited(user)).toBe(true);
  });

  it('counts recent initiations within the window', () => {
    expect(countRecentInitiations(undefined)).toBe(0);
    const recent = {
      email: 'a@b.com',
      emailVerified: true,
      createdAt: '',
      recoveryInitiatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    };
    expect(countRecentInitiations(recent)).toBe(1);
    const old = {
      email: 'a@b.com',
      emailVerified: true,
      createdAt: '',
      recoveryInitiatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    };
    expect(countRecentInitiations(old)).toBe(0);
  });

  it('validates email shape', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail(123)).toBe(false);
  });
});
