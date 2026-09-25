import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resendMailer } from './resend';

/**
 * Every case asserts on the returned value and never on a rejection: by the
 * time this runs, `api/wallet/claim-links/create` has already put an escrow
 * deposit on chain, and a thrown provider error there costs the user a second
 * deposit (issue #120).
 */

const MESSAGE = {
  to: 'bob@example.com',
  subject: 'You have 25 USDC waiting on Pocketlet',
  text: 'Sign up with this address.',
};

const originalEnv = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  MAIL_FROM: process.env.MAIL_FROM,
};

function configure(): void {
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.MAIL_FROM = 'Pocketlet <no-reply@example.com>';
}

/** Stub global fetch. Returns the spy so callers can inspect the request. */
function stubFetch(impl: () => Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
}

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('resendMailer', () => {
  it('posts the message and returns the provider id', async () => {
    configure();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'resend-message-id' }), { status: 200 })
      )
    );

    const result = await resendMailer.send(MESSAGE);
    expect(result).toEqual({
      ok: true,
      provider: 'resend',
      id: 'resend-message-id',
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    const request = init as RequestInit;
    expect(request.method).toBe('POST');
    expect((request.headers as Record<string, string>).authorization).toBe(
      'Bearer re_test_key'
    );
    expect(JSON.parse(String(request.body))).toMatchObject({
      from: 'Pocketlet <no-reply@example.com>',
      to: ['bob@example.com'],
      subject: MESSAGE.subject,
      text: MESSAGE.text,
    });
  });

  it('succeeds without an id when the body is not the documented shape', async () => {
    configure();
    stubFetch(() => Promise.resolve(new Response('accepted', { status: 202 })));
    await expect(resendMailer.send(MESSAGE)).resolves.toEqual({
      ok: true,
      provider: 'resend',
    });
  });

  it('returns a failure for a non-2xx response, with the provider detail', async () => {
    configure();
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'API key is invalid' }), {
          status: 401,
        })
      )
    );

    const result = await resendMailer.send(MESSAGE);
    expect(result.ok).toBe(false);
    expect(result.provider).toBe('resend');
    expect(result.ok === false && result.error).toContain('Resend responded 401');
    expect(result.ok === false && result.error).toContain('API key is invalid');
  });

  it('returns a failure when fetch itself rejects', async () => {
    configure();
    stubFetch(() =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND api.resend.com'))
    );
    await expect(resendMailer.send(MESSAGE)).resolves.toEqual({
      ok: false,
      provider: 'resend',
      error: 'getaddrinfo ENOTFOUND api.resend.com',
    });
  });

  it('returns a failure when the request times out', async () => {
    configure();
    stubFetch(() =>
      Promise.reject(
        new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      )
    );
    const result = await resendMailer.send(MESSAGE);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('aborted');
  });

  it('returns a failure when the response body cannot be read', async () => {
    configure();
    stubFetch(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('socket hang up')),
      } as unknown as Response)
    );
    const result = await resendMailer.send(MESSAGE);
    expect(result.ok === false && result.error).toBe('Resend responded 500');
  });

  it('does not call out when RESEND_API_KEY is missing', async () => {
    process.env.MAIL_FROM = 'no-reply@example.com';
    const fetchSpy = stubFetch(() => Promise.resolve(new Response('{}')));
    await expect(resendMailer.send(MESSAGE)).resolves.toEqual({
      ok: false,
      provider: 'resend',
      error: 'RESEND_API_KEY is not configured',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not call out when MAIL_FROM is missing', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const fetchSpy = stubFetch(() => Promise.resolve(new Response('{}')));
    await expect(resendMailer.send(MESSAGE)).resolves.toEqual({
      ok: false,
      provider: 'resend',
      error: 'MAIL_FROM is not configured',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never puts the API key in the returned result', async () => {
    configure();
    stubFetch(() => Promise.reject(new Error('connection failed')));
    const result = await resendMailer.send(MESSAGE);
    expect(JSON.stringify(result)).not.toContain('re_test_key');
  });

  it('truncates a long provider body rather than returning all of it', async () => {
    configure();
    stubFetch(() =>
      Promise.resolve(new Response('x'.repeat(10_000), { status: 400 }))
    );
    const result = await resendMailer.send(MESSAGE);
    expect(result.ok === false && result.error.length).toBeLessThan(400);
  });

  // The guarantee the rest of the codebase leans on, stated as a test rather
  // than only as a comment on the interface.
  it.each([
    ['a non-2xx response', () => Promise.resolve(new Response('no', { status: 500 }))],
    ['a rejected fetch', () => Promise.reject(new Error('boom'))],
    ['a non-Error rejection', () => Promise.reject('boom')],
    [
      'a synchronous throw',
      () => {
        throw new Error('sync boom');
      },
    ],
  ])('does not throw on %s', async (_label, impl) => {
    configure();
    stubFetch(impl as () => Promise<Response>);
    const result = await resendMailer.send(MESSAGE);
    expect(result.ok).toBe(false);
  });
});
