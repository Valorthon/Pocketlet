import { describe, it, expect } from 'vitest';
import { POST } from './route';

describe('POST /api/wallet/swap', () => {
  it('returns 410 while swaps are disabled', async () => {
    const res = await POST();
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('temporarily disabled');
  });
});
