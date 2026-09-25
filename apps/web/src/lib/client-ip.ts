/**
 * Derive the client IP bucket key for rate limiting.
 *
 * `NextRequest.ip` was removed in Next 15, so `X-Forwarded-For` is the only
 * option. That header is attacker-controlled at its *left* end, which is the
 * whole difficulty: Railway's edge proxy **appends** the socket peer address to
 * whatever the client sent, so a request from 198.51.100.9 that carries
 * `X-Forwarded-For: 1.2.3.4` arrives at the app as `1.2.3.4, 198.51.100.9`.
 *
 * Taking `split(',')[0]` — the usual reflex — therefore hands the attacker a
 * fresh rate-limit bucket on every request and defeats the limiter entirely.
 * The trustworthy entry is the **rightmost**, counted back from the end by the
 * number of proxies that sit between the app and the internet-facing edge.
 *
 * **This design assumes a proxy that appends** — which is what Railway does,
 * and what `TRUSTED_PROXY_HOP_COUNT=0` means: "the last entry was written by
 * the proxy directly in front of me". It is *not* correct for a direct
 * connection: with nothing appending the peer address, the whole header is
 * client-supplied, so the rightmost entry is whatever the caller chose. In
 * local development there is no proxy at all, honest requests carry no header,
 * and every one of them shares the single {@link UNKNOWN_CLIENT_IP} bucket —
 * so one developer can exhaust the per-IP daily budget for the environment.
 * Raise the limits locally if that bites; do not "fix" it by reading the left.
 *
 * Reasoning behind this and the rest of the limiter:
 * [ADR 0008](../../../../docs/decisions/0008-fee-payer-rate-limiting.md).
 */

/** Bucket used when no forwarding header is present (direct/local requests). */
export const UNKNOWN_CLIENT_IP = 'unknown';

function trustedProxyHopCount(): number {
  const raw = process.env.TRUSTED_PROXY_HOP_COUNT;
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/;

/** The four octets of a dotted-quad, or null if it is not one. */
function parseIpv4(text: string): number[] | null {
  const match = IPV4.exec(text);
  if (!match) {
    return null;
  }
  const octets = match.slice(1).map((part) => Number(part));
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/** The eight 16-bit groups of an IPv6 address, or null if it is not one. */
function parseIpv6(address: string): number[] | null {
  let text = address;

  // A trailing dotted-quad carries the low 32 bits (`::ffff:1.2.3.4`).
  const lastColon = text.lastIndexOf(':');
  if (lastColon === -1) {
    return null;
  }
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = parseIpv4(tail);
    if (!octets) {
      return null;
    }
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) {
      return null;
    }
    groups = head;
  } else {
    const elided = 8 - head.length - rest.length;
    if (elided < 1) {
      return null;
    }
    groups = [...head, ...Array<string>(elided).fill('0'), ...rest];
  }

  if (!groups.every((group) => IPV6_GROUP.test(group))) {
    return null;
  }
  return groups.map((group) => Number.parseInt(group, 16));
}

/**
 * Collapse an address to the unit a single client actually controls.
 *
 * IPv4 keys on the full address. **IPv6 keys on the /64 prefix**, because
 * residential and mobile ISPs delegate a /64 (2^64 addresses) to one
 * subscriber: keying on the full address would give a rotating client a fresh
 * bucket every request and the per-IP cap would never bind. An IPv4-mapped
 * address (`::ffff:1.2.3.4`) is keyed as the IPv4 address it carries, so the
 * same client cannot get two buckets by switching representation.
 *
 * Never throws. Anything unparseable — a hostname, a truncated address, junk
 * from a forged header — falls back to the trimmed input, which is still a
 * usable bucket key.
 */
export function normalizeIpForBucket(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }

  try {
    let host = trimmed;

    if (host.startsWith('[')) {
      // Bracketed IPv6, with or without a port: "[2001:db8::1]:443".
      const close = host.indexOf(']');
      if (close === -1) {
        return trimmed;
      }
      host = host.slice(1, close);
    } else if (host.indexOf(':') === host.lastIndexOf(':') && host.includes(':')) {
      // Exactly one colon: IPv4 with a port. Unbracketed IPv6 always has more.
      host = host.slice(0, host.indexOf(':'));
    }

    // Zone identifiers ("fe80::1%eth0") are link-local scope, never a bucket.
    const zone = host.indexOf('%');
    if (zone !== -1) {
      host = host.slice(0, zone);
    }

    host = host.toLowerCase();

    if (parseIpv4(host)) {
      return host;
    }

    const groups = parseIpv6(host);
    if (!groups) {
      return trimmed;
    }

    // IPv4-mapped: key it as the IPv4 address so both spellings share a bucket.
    const mapped =
      groups[5] === 0xffff && groups.slice(0, 5).every((group) => group === 0);
    if (mapped) {
      const high = groups[6];
      const low = groups[7];
      return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    }

    const prefix = groups
      .slice(0, 4)
      .map((group) => group.toString(16))
      .join(':');
    return `${prefix}::/64`;
  } catch {
    // Defensive: the limiter must never fail open (or closed) on a header.
    return trimmed;
  }
}

/**
 * The client IP bucket as seen by the outermost trusted proxy.
 *
 * Returns {@link UNKNOWN_CLIENT_IP} when nothing usable is present rather than
 * throwing or returning an empty string: a shared bucket is a safe default,
 * and an empty key would silently merge with any other empty key anyway.
 */
export function getClientIp(request: { headers: Headers }): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (entries.length > 0) {
      // Count back from the right. If the header is shorter than the
      // configured hop count the chain was truncated or forged, so fall back
      // to the leftmost entry we were actually given rather than to nothing.
      const index = Math.max(0, entries.length - 1 - trustedProxyHopCount());
      return normalizeIpForBucket(entries[index]);
    }
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return normalizeIpForBucket(realIp);
  }

  return UNKNOWN_CLIENT_IP;
}
