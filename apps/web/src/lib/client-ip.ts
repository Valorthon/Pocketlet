/**
 * Derive the client IP address for rate-limiting buckets.
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
 * `TRUSTED_PROXY_HOP_COUNT` is that number: 0 (the default) means "the last
 * entry was written by the proxy directly in front of me", which is the
 * Railway topology and also the correct answer for a direct connection.
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

/**
 * The client IP as seen by the outermost trusted proxy.
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
      return entries[index];
    }
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  return UNKNOWN_CLIENT_IP;
}
