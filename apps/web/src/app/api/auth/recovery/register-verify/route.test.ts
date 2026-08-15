import { describe, it, expect } from 'vitest';
import { POST } from './route';

describe('POST /api/auth/recovery/register-verify', () => {
  it('returns 503 while recovery is disabled', async () => {
    const res = await POST();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Recovery is temporarily disabled');
  });
});
