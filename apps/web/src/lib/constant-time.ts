import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time equality for short secrets.
 *
 * Extracted from `src/lib/admin.ts` (issue #61) when the email verification
 * and PIN reset codes needed the same treatment (issue #121). There is exactly
 * one implementation of this in the codebase on purpose: a second one is a
 * second chance to get it wrong, and the wrong version — `===` — looks
 * identical at the call site.
 */

/**
 * SHA-256 both sides before comparing. The digests are always 32 bytes, so
 * `timingSafeEqual` cannot throw on a length mismatch, and no length check is
 * needed — such a check would itself leak the secret's length.
 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * True when `a` and `b` are the same string, compared in time that does not
 * depend on how many leading characters happen to match.
 *
 * Both arguments are hashed first, so this is safe for inputs of any length
 * and never reveals the length of either through timing.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}
