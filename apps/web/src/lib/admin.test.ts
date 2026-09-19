import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { verifyAdminToken } from './admin';

const originalToken = process.env.ADMIN_SECRET_TOKEN;

const VALID_TOKEN =
  'f3b1c9a27d4e5081a6c3b2d9e7f4a1c85b0d6e3f27a9c4b18d5e0f6a3c7b9d21';

beforeEach(() => {
  process.env.ADMIN_SECRET_TOKEN = VALID_TOKEN;
});

afterAll(() => {
  if (originalToken === undefined) {
    delete process.env.ADMIN_SECRET_TOKEN;
  } else {
    process.env.ADMIN_SECRET_TOKEN = originalToken;
  }
});

describe('verifyAdminToken', () => {
  describe('unconfigured', () => {
    it('reports unconfigured when the variable is unset', () => {
      delete process.env.ADMIN_SECRET_TOKEN;
      expect(verifyAdminToken(`Bearer ${VALID_TOKEN}`)).toEqual({
        ok: false,
        reason: 'unconfigured',
      });
    });

    it('reports unconfigured when the variable is blank', () => {
      process.env.ADMIN_SECRET_TOKEN = '   ';
      expect(verifyAdminToken('Bearer anything')).toEqual({
        ok: false,
        reason: 'unconfigured',
      });
    });

    it.each(['change-me-in-production', 'dev-secret-change-in-production'])(
      'reports unconfigured for the %s placeholder',
      (placeholder) => {
        process.env.ADMIN_SECRET_TOKEN = placeholder;
        expect(verifyAdminToken(`Bearer ${placeholder}`)).toEqual({
          ok: false,
          reason: 'unconfigured',
        });
      }
    );

    it('prefers unconfigured over invalid, so the cause is never masked', () => {
      process.env.ADMIN_SECRET_TOKEN = 'change-me-in-production';
      expect(verifyAdminToken(null)).toEqual({
        ok: false,
        reason: 'unconfigured',
      });
    });
  });

  describe('invalid', () => {
    it('rejects a missing header', () => {
      expect(verifyAdminToken(null)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('rejects a non-Bearer scheme', () => {
      expect(verifyAdminToken(`Basic ${VALID_TOKEN}`)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('rejects a bare token with no scheme', () => {
      expect(verifyAdminToken(VALID_TOKEN)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('rejects a wrong token of the same length', () => {
      const wrong = 'a'.repeat(VALID_TOKEN.length);
      expect(verifyAdminToken(`Bearer ${wrong}`)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    // timingSafeEqual throws on buffers of unequal length; hashing both sides
    // to a fixed 32 bytes is what keeps these from blowing up.
    it('rejects a shorter token without throwing', () => {
      expect(() => verifyAdminToken('Bearer short')).not.toThrow();
      expect(verifyAdminToken('Bearer short')).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('rejects a longer token without throwing', () => {
      expect(verifyAdminToken(`Bearer ${VALID_TOKEN}extra`)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('rejects an empty bearer token', () => {
      expect(verifyAdminToken('Bearer ')).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });
  });

  describe('accepted', () => {
    it('accepts the configured token', () => {
      expect(verifyAdminToken(`Bearer ${VALID_TOKEN}`)).toEqual({ ok: true });
    });

    it('tolerates surrounding whitespace on the token', () => {
      expect(verifyAdminToken(`Bearer  ${VALID_TOKEN}  `)).toEqual({
        ok: true,
      });
    });

    it('tolerates surrounding whitespace on the configured value', () => {
      process.env.ADMIN_SECRET_TOKEN = `  ${VALID_TOKEN}  `;
      expect(verifyAdminToken(`Bearer ${VALID_TOKEN}`)).toEqual({ ok: true });
    });
  });
});
