import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';

const originalEnv = {
  NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE:
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
  SESSION_SECRET: process.env.SESSION_SECRET,
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID,
  WEBAUTHN_ORIGIN: process.env.WEBAUTHN_ORIGIN,
  PASSKEY_RELAYER_BASE_URL: process.env.PASSKEY_RELAYER_BASE_URL,
  PASSKEY_RELAYER_API_KEY: process.env.PASSKEY_RELAYER_API_KEY,
};

function clearRelayerEnv(): void {
  delete process.env.PASSKEY_RELAYER_BASE_URL;
  delete process.env.PASSKEY_RELAYER_API_KEY;
}

function setValidRelayerEnv(): void {
  process.env.PASSKEY_RELAYER_BASE_URL = 'https://channels.example.com/mainnet';
  process.env.PASSKEY_RELAYER_API_KEY = 'secret-api-key';
}

beforeAll(() => {
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
  delete process.env.SESSION_SECRET;
  delete process.env.WEBAUTHN_RP_ID;
  delete process.env.WEBAUTHN_ORIGIN;
  clearRelayerEnv();
});

afterAll(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE =
    originalEnv.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
  process.env.SESSION_SECRET = originalEnv.SESSION_SECRET;
  process.env.WEBAUTHN_RP_ID = originalEnv.WEBAUTHN_RP_ID;
  process.env.WEBAUTHN_ORIGIN = originalEnv.WEBAUTHN_ORIGIN;
  process.env.PASSKEY_RELAYER_BASE_URL = originalEnv.PASSKEY_RELAYER_BASE_URL;
  process.env.PASSKEY_RELAYER_API_KEY = originalEnv.PASSKEY_RELAYER_API_KEY;
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
    setValidRelayerEnv();
    await expect(importConfig()).rejects.toThrow(
      'WEBAUTHN_ORIGIN must be a valid HTTPS URL'
    );
  });

  it('throws in production when WEBAUTHN_RP_ID is localhost', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.SESSION_SECRET = 'strong-production-secret-32-characters';
    process.env.WEBAUTHN_RP_ID = 'localhost';
    process.env.WEBAUTHN_ORIGIN = 'https://example.com';
    setValidRelayerEnv();
    await expect(importConfig()).rejects.toThrow(
      'WEBAUTHN_RP_ID must be a real domain'
    );
  });

  it('throws in production when PASSKEY_RELAYER_BASE_URL is missing', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.SESSION_SECRET = 'strong-production-secret-32-characters';
    process.env.WEBAUTHN_RP_ID = 'example.com';
    process.env.WEBAUTHN_ORIGIN = 'https://example.com';
    clearRelayerEnv();
    await expect(importConfig()).rejects.toThrow(
      'PASSKEY_RELAYER_BASE_URL is required in production'
    );
  });

  it('throws in production when PASSKEY_RELAYER_API_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.SESSION_SECRET = 'strong-production-secret-32-characters';
    process.env.WEBAUTHN_RP_ID = 'example.com';
    process.env.WEBAUTHN_ORIGIN = 'https://example.com';
    process.env.PASSKEY_RELAYER_BASE_URL = 'https://channels.example.com/mainnet';
    delete process.env.PASSKEY_RELAYER_API_KEY;
    await expect(importConfig()).rejects.toThrow(
      'PASSKEY_RELAYER_API_KEY is required in production'
    );
  });

  it('accepts a valid production configuration', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.SESSION_SECRET = 'strong-production-secret-32-characters';
    process.env.WEBAUTHN_RP_ID = 'example.com';
    process.env.WEBAUTHN_ORIGIN = 'https://example.com';
    setValidRelayerEnv();
    const mod = await importConfig();
    expect(mod.SESSION_SECRET).toBe('strong-production-secret-32-characters');
    expect(mod.RP_ID).toBe('example.com');
    expect(mod.ORIGIN).toBe('https://example.com');
  });
});
