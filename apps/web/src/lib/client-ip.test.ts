import { describe, it, expect, afterEach, vi } from 'vitest';
import { getClientIp, UNKNOWN_CLIENT_IP } from './client-ip';

function req(headers: Record<string, string>) {
  return { headers: new Headers(headers) };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getClientIp', () => {
  it('uses the rightmost X-Forwarded-For entry, not the leftmost', () => {
    // Railway's edge appends the socket peer address, so the client-supplied
    // prefix is the untrusted part. split(',')[0] would return '1.2.3.4'.
    expect(getClientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))).toBe(
      '203.0.113.9'
    );
  });

  it('ignores a forged chain of any length', () => {
    expect(
      getClientIp(
        req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.9' })
      )
    ).toBe('203.0.113.9');
  });

  it('handles a single entry', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.9' }))).toBe(
      '203.0.113.9'
    );
  });

  it('trims whitespace and skips empty entries', () => {
    expect(
      getClientIp(req({ 'x-forwarded-for': ' 1.2.3.4 ,  203.0.113.9  , ' }))
    ).toBe('203.0.113.9');
  });

  it('skips one extra hop when TRUSTED_PROXY_HOP_COUNT is 1', () => {
    vi.stubEnv('TRUSTED_PROXY_HOP_COUNT', '1');
    expect(
      getClientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9, 10.0.0.1' }))
    ).toBe('203.0.113.9');
  });

  it('falls back to the leftmost entry when the chain is shorter than the hop count', () => {
    // A truncated or forged chain must still yield a key; the leftmost entry we
    // were actually given is the closest thing to the client we have.
    vi.stubEnv('TRUSTED_PROXY_HOP_COUNT', '5');
    expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.9' }))).toBe(
      '203.0.113.9'
    );
  });

  it.each(['', 'nonsense', '-1'])(
    'treats %o as a hop count of zero',
    (raw) => {
      vi.stubEnv('TRUSTED_PROXY_HOP_COUNT', raw);
      expect(
        getClientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))
      ).toBe('203.0.113.9');
    }
  );

  it('falls back to X-Real-IP when X-Forwarded-For is absent', () => {
    expect(getClientIp(req({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('returns the shared unknown bucket when no forwarding header is present', () => {
    expect(getClientIp(req({}))).toBe(UNKNOWN_CLIENT_IP);
  });

  it('returns the shared unknown bucket for an all-empty header', () => {
    expect(getClientIp(req({ 'x-forwarded-for': ' , , ' }))).toBe(
      UNKNOWN_CLIENT_IP
    );
  });
});
