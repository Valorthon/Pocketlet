import { describe, it, expect } from 'vitest';
import { constantTimeEquals } from './constant-time';

/**
 * Behaviour, not timing.
 *
 * A timing assertion would be flaky on any shared runner, so what is pinned
 * here is the shape that makes constant time possible: both sides are hashed
 * to a fixed 32 bytes, so no input length can make the comparison throw and no
 * prefix match can short-circuit it.
 */
describe('constantTimeEquals', () => {
  it('is true only for identical strings', () => {
    expect(constantTimeEquals('123456', '123456')).toBe(true);
    expect(constantTimeEquals('', '')).toBe(true);
    expect(constantTimeEquals('123456', '123457')).toBe(false);
  });

  it('does not throw on differing lengths, and is not a prefix match', () => {
    expect(constantTimeEquals('123456', '12345')).toBe(false);
    expect(constantTimeEquals('123456', '1234567')).toBe(false);
    expect(constantTimeEquals('123456', '')).toBe(false);
    expect(constantTimeEquals('a'.repeat(10_000), 'a'.repeat(10_001))).toBe(false);
  });

  it('is case- and whitespace-sensitive', () => {
    expect(constantTimeEquals('abc', 'ABC')).toBe(false);
    expect(constantTimeEquals('abc', ' abc')).toBe(false);
  });

  /**
   * The primitive must not be the thing that throws.
   *
   * Route handlers cast a parsed JSON body (`body as { code?: string }`) and
   * hand a field straight to this function. The cast is a claim, not a check:
   * `{"code": 654321}` satisfied it, reached `createHash().update(value)` and
   * raised `ERR_INVALID_ARG_TYPE`, turning what should have been a 401 into an
   * unhandled rejection and a 500. Anything that is not a string is simply not
   * equal — it fails closed.
   */
  it('is false, not an exception, for a non-string', () => {
    expect(constantTimeEquals(654321, '654321')).toBe(false);
    expect(constantTimeEquals('654321', 654321)).toBe(false);
    expect(constantTimeEquals(undefined, '123456')).toBe(false);
    expect(constantTimeEquals(null, '123456')).toBe(false);
    expect(constantTimeEquals('123456', { toString: () => '123456' })).toBe(false);
    expect(constantTimeEquals(['123456'], '123456')).toBe(false);
  });

  it('never says two non-strings are equal', () => {
    // Otherwise a missing stored secret would match a missing submitted one.
    expect(constantTimeEquals(undefined, undefined)).toBe(false);
    expect(constantTimeEquals(null, null)).toBe(false);
    expect(constantTimeEquals(654321, 654321)).toBe(false);
  });

  it('compares by code point, not by UTF-8 byte accident', () => {
    expect(constantTimeEquals('é', 'é')).toBe(true);
    expect(constantTimeEquals('é', 'e')).toBe(false);
  });
});
