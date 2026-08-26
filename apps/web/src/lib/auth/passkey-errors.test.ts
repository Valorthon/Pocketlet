import { describe, it, expect, vi, afterEach } from 'vitest';
import { PasskeyKitError, WebAuthnError, PasskeyKitErrorCode } from 'passkey-kit';
import {
  checkPasskeySupport,
  formatPasskeyKitError,
  logPasskeyKitError,
} from './passkey-errors';

describe('formatPasskeyKitError', () => {
  it('returns generic message for non-Error values', () => {
    expect(formatPasskeyKitError(null)).toBe('Passkey registration failed');
    expect(formatPasskeyKitError(undefined)).toBe('Passkey registration failed');
    expect(formatPasskeyKitError(42)).toBe('Passkey registration failed');
  });

  it('returns the message for a plain Error', () => {
    expect(formatPasskeyKitError(new Error('Something broke'))).toBe(
      'Something broke'
    );
  });

  it('unwraps the cause for a WebAuthnError', () => {
    const cause = new Error('NotAllowedError: User canceled');
    const err = new WebAuthnError(
      'Passkey registration failed',
      PasskeyKitErrorCode.WEBAUTHN_REGISTRATION_FAILED,
      cause
    );
    expect(formatPasskeyKitError(err)).toBe(
      'Passkey registration failed: NotAllowedError: User canceled'
    );
  });

  it('unwraps the cause for a generic PasskeyKitError', () => {
    const cause = new Error('Network timeout');
    const err = new PasskeyKitError(
      'Submission failed',
      PasskeyKitErrorCode.SUBMISSION_FAILED,
      { cause }
    );
    expect(formatPasskeyKitError(err)).toBe('Submission failed: Network timeout');
  });

  it('falls back to message when PasskeyKitError has no cause', () => {
    const err = new PasskeyKitError(
      'Missing config',
      PasskeyKitErrorCode.MISSING_CONFIG
    );
    expect(formatPasskeyKitError(err)).toBe('Missing config');
  });
});

describe('logPasskeyKitError', () => {
  it('logs a plain Error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logPasskeyKitError(new Error('Oops'));
    expect(consoleSpy).toHaveBeenCalledWith('Error:', 'Oops', expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('logs an unknown value', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logPasskeyKitError('string error');
    expect(consoleSpy).toHaveBeenCalledWith('Unknown error:', 'string error');
    consoleSpy.mockRestore();
  });

  it('logs detailed string for PasskeyKitError when available', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new PasskeyKitError(
      'Detailed',
      PasskeyKitErrorCode.MISSING_CONFIG
    );
    vi.spyOn(err, 'toDetailedString').mockReturnValue('DETAILED-MSG');
    logPasskeyKitError(err);
    expect(consoleSpy).toHaveBeenCalledWith(
      'PasskeyKitError:',
      'DETAILED-MSG'
    );
    consoleSpy.mockRestore();
  });
});

describe('checkPasskeySupport', () => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;

  function setWindow(value: unknown) {
    Object.defineProperty(globalThis, 'window', {
      value,
      writable: true,
      configurable: true,
    });
  }

  function setNavigator(value: unknown) {
    Object.defineProperty(globalThis, 'navigator', {
      value,
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    setWindow(originalWindow);
    setNavigator(originalNavigator);
  });

  it('returns null when passkeys are supported', () => {
    setWindow({
      isSecureContext: true,
      PublicKeyCredential: class {},
    });
    setNavigator({ credentials: {} });
    expect(checkPasskeySupport()).toBeNull();
  });

  it('returns error when not secure context', () => {
    setWindow({ isSecureContext: false });
    expect(checkPasskeySupport()).toBe(
      'Passkeys require a secure context. Use https://localhost or http://localhost:3000.'
    );
  });

  it('returns error when PublicKeyCredential is missing', () => {
    setWindow({ isSecureContext: true, PublicKeyCredential: undefined });
    setNavigator({ credentials: {} });
    expect(checkPasskeySupport()).toBe(
      'Passkeys are not supported on this browser or device.'
    );
  });

  it('returns error when navigator.credentials is missing', () => {
    setWindow({ isSecureContext: true, PublicKeyCredential: class {} });
    setNavigator({ credentials: undefined });
    expect(checkPasskeySupport()).toBe(
      'Credential Management API is not available on this browser.'
    );
  });
});
