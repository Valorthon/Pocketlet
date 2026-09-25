import { vi } from 'vitest';
import {
  consumeRateLimit,
  rateLimitBucket,
  type FeePayerRoute,
} from './rate-limit';

/**
 * Helper for the per-route rate-limit enforcement tests.
 *
 * The limiter's own behaviour — windows, resets, `Retry-After`, IP bucketing,
 * concurrency — is covered once in `src/lib/rate-limit.test.ts`. What that
 * cannot cover is the *wiring*: the `enforceFeePayerRateLimit` call lives in
 * each handler separately, so it can be deleted from one route with the whole
 * suite still green. Every limited route therefore carries one cheap test that
 * only asks "does this handler charge the limiter at all?".
 *
 * See [ADR 0008](../../../../docs/decisions/0008-fee-payer-rate-limiting.md).
 */

const MINUTE_MS = 60_000;

/**
 * Leave the caller with no fee-payer budget left on `route`.
 *
 * Sets the per-user, per-minute limit to 1 and spends it, so the next request
 * the handler makes must come back 429 — if it reaches the limiter at all.
 * Going through the bucket directly rather than replaying a successful request
 * keeps the test to one extra round trip and works for the routes whose happy
 * path can only run once (a claim link is claimed, a passkey challenge is
 * burnt, a wallet is already deployed).
 *
 * Stubs the environment, so the calling test file needs
 * `afterEach(() => vi.unstubAllEnvs())`.
 */
export async function exhaustFeePayerBudget(
  route: FeePayerRoute,
  email: string
): Promise<void> {
  vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '1');

  const decision = await consumeRateLimit(
    rateLimitBucket(route, 'user', email.trim().toLowerCase(), MINUTE_MS),
    { limit: 1, windowMs: MINUTE_MS }
  );

  if (!decision.allowed) {
    throw new Error(
      `rate-limit bucket for ${route}/${email} was already spent; a previous test leaked a row`
    );
  }
}
