import { describe, it, expect, afterEach, vi } from 'vitest';
import { logMailer } from './log';

const MESSAGE = {
  to: 'bob@example.com',
  subject: 'You have 25 USDC waiting on Pocketlet',
  text: 'Sign up with this address.',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logMailer', () => {
  it('reports success and writes the message to stdout', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await logMailer.send(MESSAGE);

    expect(result).toEqual({ ok: true, provider: 'log' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('bob@example.com');
    expect(log.mock.calls[0][0]).toContain('Sign up with this address.');
  });

  it('sends nothing over the network', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'));

    await logMailer.send(MESSAGE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // The never-throws contract has no exceptions, not even the implementation
  // that cannot realistically fail.
  it('returns a failure rather than throwing if logging itself fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {
      throw new Error('stdout is closed');
    });
    await expect(logMailer.send(MESSAGE)).resolves.toEqual({
      ok: false,
      provider: 'log',
      error: 'stdout is closed',
    });
  });
});
