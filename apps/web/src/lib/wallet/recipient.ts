import { Address } from '@stellar/stellar-sdk';
import { getUserByEmail, getUserByPhone, getUserByUsername, isValidPhone, isValidUsername, normalizePhone, normalizeUsername } from '@/lib/auth/store';
import { isValidEmailFormat } from './recipient-format';

export type RecipientType = 'address' | 'username' | 'phone' | 'email';

export interface ResolvedRecipient {
  type: RecipientType;
  address: string;
  display: string;
}

export async function resolveRecipient(
  input: string
): Promise<ResolvedRecipient | null> {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  // 1. Raw Stellar address (G... account or C... contract)
  try {
    Address.fromString(trimmed);
    return { type: 'address', address: trimmed, display: trimmed };
  } catch {
    // not a raw address
  }

  // 2. Phone number (+...)
  if (isValidPhone(trimmed)) {
    const normalized = normalizePhone(trimmed);
    const user = await getUserByPhone(normalized);
    if (user?.stellarAddress) {
      return {
        type: 'phone',
        address: user.stellarAddress,
        display: normalized,
      };
    }
  }

  // 3. Username (@... or plain)
  if (isValidUsername(trimmed)) {
    const normalized = normalizeUsername(trimmed);
    const user = await getUserByUsername(normalized);
    if (user?.stellarAddress) {
      return {
        type: 'username',
        address: user.stellarAddress,
        display: `@${normalized}`,
      };
    }
  }

  // 4. Email — users.email is the primary key. getUserByEmail normalizes
  // (trim + lowercase) internally, so mixed-case input resolves, and
  // user.email is the stored normalized value.
  if (isValidEmailFormat(trimmed)) {
    const user = await getUserByEmail(trimmed);
    if (user?.stellarAddress) {
      return {
        type: 'email',
        address: user.stellarAddress,
        display: user.email,
      };
    }
  }

  return null;
}
