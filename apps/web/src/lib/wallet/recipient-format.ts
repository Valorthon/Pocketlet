import { Address } from '@stellar/stellar-sdk';

/**
 * Pure, client-safe recipient format validation.
 *
 * These rules mirror the server-side user lookup (see `@/lib/auth/store`), but
 * contain no filesystem/server imports so they can run in the browser and on
 * the server. They validate *format only*; existence is resolved elsewhere.
 */

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/^@/, '');
}

export function isValidUsernameFormat(username: string): boolean {
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

export function isValidPhoneFormat(phone: string): boolean {
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

export function isValidAddressFormat(address: string): boolean {
  try {
    Address.fromString(address.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * Return an error message if the recipient input does not match any supported
 * format (Stellar address, phone number, or username), or null if it is valid.
 */
export function validateRecipientFormat(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return 'Recipient is required';
  }

  if (isValidAddressFormat(trimmed)) {
    return null;
  }
  if (isValidPhoneFormat(trimmed)) {
    return null;
  }
  if (isValidUsernameFormat(trimmed)) {
    return null;
  }

  return 'Enter a valid username, phone number, or Stellar address.';
}
