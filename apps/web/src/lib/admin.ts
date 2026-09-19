import { createHash, timingSafeEqual } from 'node:crypto';

/** Placeholder values shipped in .env.example — never valid tokens. */
const DEFAULT_ADMIN_TOKENS = [
  'change-me-in-production',
  'dev-secret-change-in-production',
];

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; reason: 'unconfigured' | 'invalid' };

/**
 * SHA-256 both sides before comparing. The digests are always 32 bytes, so
 * timingSafeEqual cannot throw on a length mismatch, and no length check is
 * needed — such a check would itself leak the secret's length.
 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function verifyAdminToken(authHeader: string | null): AdminAuthResult {
  const expected = process.env.ADMIN_SECRET_TOKEN?.trim();
  if (!expected || DEFAULT_ADMIN_TOKENS.includes(expected)) {
    return { ok: false, reason: 'unconfigured' };
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, reason: 'invalid' };
  }

  const token = authHeader.slice('Bearer '.length).trim();
  return timingSafeEqual(digest(token), digest(expected))
    ? { ok: true }
    : { ok: false, reason: 'invalid' };
}
