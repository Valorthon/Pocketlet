import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getMailer, describeError } from './mailer';
import { logMailer } from './log';
import { resendMailer } from './resend';

const originalKey = process.env.RESEND_API_KEY;

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
});

describe('getMailer', () => {
  // The default has to work with no configuration at all: testnet development
  // and the whole test suite run on it.
  it('falls back to the log mailer when no provider is configured', () => {
    expect(getMailer()).toBe(logMailer);
  });

  it('uses Resend once RESEND_API_KEY is set', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    expect(getMailer()).toBe(resendMailer);
  });

  it('treats a blank RESEND_API_KEY as unset rather than as configured', () => {
    process.env.RESEND_API_KEY = '   ';
    expect(getMailer()).toBe(logMailer);
  });
});

describe('describeError', () => {
  it('uses the message of an Error', () => {
    expect(describeError(new Error('nope'))).toBe('nope');
  });

  it('falls back to the name for an Error with no message', () => {
    expect(describeError(new TypeError())).toBe('TypeError');
  });

  it('passes a thrown string through', () => {
    expect(describeError('plain string')).toBe('plain string');
  });

  it.each([[null], [undefined], [42], [{}], ['']])(
    'describes %s without throwing',
    (value) => {
      expect(describeError(value)).toBe('Unknown error');
    }
  );
});
