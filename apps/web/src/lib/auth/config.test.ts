import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';

const originalEnv = {
  NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE:
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
  SESSION_SECRET: process.env.SESSION_SECRET,
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID,
  WEBAUTHN_ORIGIN: process.env.WEBAUTHN_ORIGIN,
  FEE_PAYER_SECRET_KEY: process.env.FEE_PAYER_SECRET_KEY,
  CLAIM_SECRET_ENCRYPTION_KEY: process.env.CLAIM_SECRET_ENCRYPTION_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  MAIL_FROM: process.env.MAIL_FROM,
};

function clearFeePayerEnv(): void {
  delete process.env.FEE_PAYER_SECRET_KEY;
}

function setValidFeePayerEnv(): void {
  process.env.FEE_PAYER_SECRET_KEY =
    'SBI2ATXEXZNK7L53NN4AWQMVCZB2HVULL3LKM7FYVZWL25IUHJOE65YS';
}

/** Production also requires a mail provider — see issue #60. */
function setValidMailEnv(): void {
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.MAIL_FROM = 'Pocketlet <no-reply@example.com>';
}

function setValidClaimSecretEnv(): void {
  process.env.CLAIM_SECRET_ENCRYPTION_KEY =
    '9f2c7a1e5b3d80460fae1c9d7b25380e46af1c9d7b25380e46af1c9d7b25380e';
}

beforeAll(() => {
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
  delete process.env.SESSION_SECRET;
  delete process.env.WEBAUTHN_RP_ID;
  delete process.env.WEBAUTHN_ORIGIN;
  clearFeePayerEnv();
  delete process.env.CLAIM_SECRET_ENCRYPTION_KEY;
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
});

afterAll(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE =
    originalEnv.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
  process.env.SESSION_SECRET = originalEnv.SESSION_SECRET;
  process.env.WEBAUTHN_RP_ID = originalEnv.WEBAUTHN_RP_ID;
  process.env.WEBAUTHN_ORIGIN = originalEnv.WEBAUTHN_ORIGIN;
  process.env.FEE_PAYER_SECRET_KEY = originalEnv.FEE_PAYER_SECRET_KEY;
  process.env.CLAIM_SECRET_ENCRYPTION_KEY =
    originalEnv.CLAIM_SECRET_ENCRYPTION_KEY;
  if (originalEnv.RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalEnv.RESEND_API_KEY;
  if (originalEnv.MAIL_FROM === undefined) delete process.env.MAIL_FROM;
  else process.env.MAIL_FROM = originalEnv.MAIL_FROM;
});

async function importConfig() {
  vi.resetModules();
  const mod = await import('./config');
  return mod;
}

describe('auth config', () => {
  it('uses dev defaults on testnet', async () => {
    const mod = await importConfig();
    expect(mod.RP_NAME).toBe('Pocketlet');
    expect(mod.RP_ID).toBe('localhost');
    expect(mod.ORIGIN).toBe('http://localhost:3000');
    expect(mod.SESSION_SECRET).toBe('dev-secret-change-in-production');
    expect(mod.SESSION_COOKIE_NAME).toBe('pocketlet_session');
    expect(mod.SESSION_MAX_AGE).toBe(60 * 60 * 24 * 7);
  });

  it('throws in production when SESSION_SECRET is missing', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    delete process.env.SESSION_SECRET;
    await expect(importConfig()).rejects.toThrow(
      'SESSION_SECRET is required in production'
    );
  });

  it('throws in production when SESSION_SECRET is the default', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.SESSION_SECRET = 'change-me-in-production';
    await expect(importConfig()).rejects.toThrow(
      'cannot use the default/dev value'
    );
  });

  it('throws in production when SESSION_SECRET is too short', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.SESSION_SECRET = 'short-secret';
    await expect(importConfig()).rejects.toThrow(
      'must be at least 32 characters'
    );
  });

  it('throws in production when WEBAUTHN_ORIGIN is not HTTPS', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.SESSION_SECRET = 'strong-production-secret-32-characters';
    process.env.WEBAUTHN_RP_ID = 'example.com';
    process.env.WEBAUTHN_ORIGIN = 'http://example.com';
    setValidFeePayerEnv();
    await expect(importConfig()).rejects.toThrow(
      'WEBAUTHN_ORIGIN must be a valid HTTPS URL'
    );
  });

  it('throws in production when WEBAUTHN_RP_ID is localhost', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.SESSION_SECRET = 'strong-production-secret-32-characters';
    process.env.WEBAUTHN_RP_ID = 'localhost';
    process.env.WEBAUTHN_ORIGIN = 'https://example.com';
    setValidFeePayerEnv();
    await expect(importConfig()).rejects.toThrow(
      'WEBAUTHN_RP_ID must be a real domain'
    );
  });

  it('throws in production when FEE_PAYER_SECRET_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.SESSION_SECRET = 'strong-production-secret-32-characters';
    process.env.WEBAUTHN_RP_ID = 'example.com';
    process.env.WEBAUTHN_ORIGIN = 'https://example.com';
    clearFeePayerEnv();
    setValidClaimSecretEnv();
    await expect(importConfig()).rejects.toThrow(
      'FEE_PAYER_SECRET_KEY is required in production'
    );
  });

  // Runtime never used to check this one — only next.config.mjs did, and with
  // output: 'standalone' that copy does not re-run in the deployed container.
  it('throws in production when CLAIM_SECRET_ENCRYPTION_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.SESSION_SECRET = 'strong-production-secret-32-characters';
    process.env.WEBAUTHN_RP_ID = 'example.com';
    process.env.WEBAUTHN_ORIGIN = 'https://example.com';
    setValidFeePayerEnv();
    delete process.env.CLAIM_SECRET_ENCRYPTION_KEY;
    await expect(importConfig()).rejects.toThrow(
      'CLAIM_SECRET_ENCRYPTION_KEY is required in production'
    );
  });

  it('throws in production when a secret is still a placeholder', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.SESSION_SECRET = 'strong-production-secret-32-characters';
    process.env.WEBAUTHN_RP_ID = 'example.com';
    process.env.WEBAUTHN_ORIGIN = 'https://example.com';
    process.env.FEE_PAYER_SECRET_KEY = 'change-me-in-production';
    setValidClaimSecretEnv();
    await expect(importConfig()).rejects.toThrow(
      'FEE_PAYER_SECRET_KEY cannot use the default/dev value'
    );
  });

  it('accepts a valid production configuration', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.SESSION_SECRET = 'strong-production-secret-32-characters';
    process.env.WEBAUTHN_RP_ID = 'example.com';
    process.env.WEBAUTHN_ORIGIN = 'https://example.com';
    setValidFeePayerEnv();
    setValidClaimSecretEnv();
    setValidMailEnv();
    const mod = await importConfig();
    expect(mod.SESSION_SECRET).toBe('strong-production-secret-32-characters');
    expect(mod.RP_ID).toBe('example.com');
    expect(mod.ORIGIN).toBe('https://example.com');
  });

  it('falls back to localhost when WEBAUTHN_RP_ID is empty string', async () => {
    delete process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
    process.env.WEBAUTHN_RP_ID = '';
    const mod = await importConfig();
    expect(mod.RP_ID).toBe('localhost');
  });
});
