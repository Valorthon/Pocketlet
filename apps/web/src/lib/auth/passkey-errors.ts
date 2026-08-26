import { PasskeyKitError, WebAuthnError } from 'passkey-kit';

export function formatPasskeyKitError(err: unknown): string {
  if (err instanceof WebAuthnError && err.cause) {
    return `${err.message}: ${err.cause.message}`;
  }
  if (err instanceof PasskeyKitError && err.cause) {
    return `${err.message}: ${err.cause.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Passkey registration failed';
}

export function logPasskeyKitError(err: unknown): void {
  if (
    err instanceof PasskeyKitError &&
    typeof err.toDetailedString === 'function'
  ) {
    console.error('PasskeyKitError:', err.toDetailedString());
  } else if (err instanceof Error) {
    console.error('Error:', err.message, err);
  } else {
    console.error('Unknown error:', err);
  }
}

export function checkPasskeySupport(): string | null {
  if (typeof window === 'undefined') {
    return 'Window object is not available.';
  }
  if (!window.isSecureContext) {
    return 'Passkeys require a secure context. Use https://localhost or http://localhost:3000.';
  }
  if (!window.PublicKeyCredential) {
    return 'Passkeys are not supported on this browser or device.';
  }
  if (!navigator.credentials) {
    return 'Credential Management API is not available on this browser.';
  }
  return null;
}
