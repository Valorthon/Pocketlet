import type { Mailer, MailMessage, MailResult } from './mailer';
import { describeError } from './mailer';

/**
 * Resend, over its documented REST endpoint with plain `fetch`.
 *
 * No `resend` npm package on purpose: the call is one POST with a bearer
 * token, and the `Mailer` seam is what makes the vendor cheap to change — a
 * dependency would buy nothing here and has to be kept current.
 *
 * Every failure mode (non-2xx, DNS, TLS, timeout, malformed body, anything
 * unexpected) comes back as `{ ok: false }`. Nothing escapes.
 */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 10_000;
/** Keep provider text out of unbounded growth in the notifications table. */
const MAX_DETAIL_CHARS = 300;

/** Read a response body without ever throwing; '' when it cannot be read. */
async function readBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, MAX_DETAIL_CHARS);
  } catch {
    return '';
  }
}

/** Pull Resend's `id` out of a success body, tolerating any shape. */
function parseId(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'id' in parsed) {
      const id = (parsed as { id: unknown }).id;
      if (typeof id === 'string') return id;
    }
  } catch {
    // A 2xx with an unparseable body is still a send; the id is a nicety.
  }
  return undefined;
}

export const resendMailer: Mailer = {
  name: 'resend',

  async send(message: MailMessage): Promise<MailResult> {
    try {
      // Read at send time, not at module scope: the guardrails run at boot and
      // tests set these per case.
      const apiKey = process.env.RESEND_API_KEY?.trim();
      const from = process.env.MAIL_FROM?.trim();
      if (!apiKey) {
        return {
          ok: false,
          provider: 'resend',
          error: 'RESEND_API_KEY is not configured',
        };
      }
      if (!from) {
        return {
          ok: false,
          provider: 'resend',
          error: 'MAIL_FROM is not configured',
        };
      }

      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          // The key goes in the header and nowhere else — never logged, never
          // stored on the notification row.
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const body = await readBody(response);
      if (!response.ok) {
        return {
          ok: false,
          provider: 'resend',
          error: `Resend responded ${response.status}${body ? `: ${body}` : ''}`,
        };
      }

      return { ok: true, provider: 'resend', id: parseId(body) };
    } catch (err) {
      return { ok: false, provider: 'resend', error: describeError(err) };
    }
  },
};
