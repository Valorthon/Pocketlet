import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getClientIp,
  normalizeIpForBucket,
  UNKNOWN_CLIENT_IP,
} from './client-ip';

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

/**
 * IPv6 bucketing.
 *
 * Residential and mobile ISPs delegate a /64 to one subscriber, so keying on
 * the full address hands a rotating client a fresh bucket every request and
 * the per-IP cap never binds. The bucket is therefore the /64 prefix.
 */
describe('normalizeIpForBucket', () => {
  it('gives two addresses in the same /64 the same bucket', () => {
    expect(normalizeIpForBucket('2001:db8:abcd:1234::1')).toBe(
      normalizeIpForBucket('2001:db8:abcd:1234:ffff:ffff:ffff:ffff')
    );
  });

  it('gives addresses in different /64s different buckets', () => {
    expect(normalizeIpForBucket('2001:db8:abcd:1234::1')).not.toBe(
      normalizeIpForBucket('2001:db8:abcd:1235::1')
    );
  });

  it('leaves IPv4 alone, in full', () => {
    expect(normalizeIpForBucket('203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIpForBucket('203.0.113.9')).not.toBe(
      normalizeIpForBucket('203.0.113.10')
    );
  });

  it('strips a port from an IPv4 address', () => {
    expect(normalizeIpForBucket('203.0.113.9:44321')).toBe('203.0.113.9');
  });

  it('accepts bracketed IPv6, with and without a port', () => {
    const plain = normalizeIpForBucket('2001:db8:abcd:1234::1');
    expect(normalizeIpForBucket('[2001:db8:abcd:1234::1]')).toBe(plain);
    expect(normalizeIpForBucket('[2001:db8:abcd:1234::1]:443')).toBe(plain);
  });

  it('treats an IPv4-mapped IPv6 address as the IPv4 address it carries', () => {
    // Otherwise one client gets two buckets by changing spelling.
    expect(normalizeIpForBucket('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIpForBucket('[::ffff:203.0.113.9]:443')).toBe('203.0.113.9');
  });

  it('ignores a zone identifier', () => {
    expect(normalizeIpForBucket('fe80::1%eth0')).toBe(
      normalizeIpForBucket('fe80::2')
    );
  });

  it('is case-insensitive', () => {
    expect(normalizeIpForBucket('2001:DB8:ABCD:1234::1')).toBe(
      normalizeIpForBucket('2001:db8:abcd:1234::1')
    );
  });

  it('expands an elided run before taking the prefix', () => {
    expect(normalizeIpForBucket('2001:db8::1')).toBe(
      normalizeIpForBucket('2001:0db8:0000:0000:0000:0000:0000:0099')
    );
  });

  it.each([
    'not-an-ip',
    '2001:db8:::1',
    '[2001:db8::1',
    '999.999.999.999',
    '2001:db8:abcd:1234::gggg',
    '::ffff:999.1.1.1',
    '1:2:3:4:5:6:7',
    '',
    '   ',
  ])('falls back to the trimmed input for %o rather than throwing', (raw) => {
    expect(() => normalizeIpForBucket(raw)).not.toThrow();
    expect(normalizeIpForBucket(raw)).toBe(raw.trim());
  });
});

describe('getClientIp with IPv6', () => {
  it('buckets a rotating client in one /64 together', () => {
    const first = getClientIp(
      req({ 'x-forwarded-for': '1.2.3.4, 2001:db8:abcd:1234::a1' })
    );
    const second = getClientIp(
      req({ 'x-forwarded-for': '1.2.3.4, 2001:db8:abcd:1234::b2' })
    );
    expect(first).toBe(second);
  });

  it('keeps a different /64 in a different bucket', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '2001:db8:abcd:1234::1' }))).not.toBe(
      getClientIp(req({ 'x-forwarded-for': '2001:db8:abcd:9999::1' }))
    );
  });

  it('normalises X-Real-IP the same way', () => {
    expect(getClientIp(req({ 'x-real-ip': '[2001:db8:abcd:1234::1]:443' }))).toBe(
      getClientIp(req({ 'x-forwarded-for': '2001:db8:abcd:1234::2' }))
    );
  });

  it('never throws on a malformed header', () => {
    expect(() =>
      getClientIp(req({ 'x-forwarded-for': 'nonsense, [2001:db8::' }))
    ).not.toThrow();
  });
});
