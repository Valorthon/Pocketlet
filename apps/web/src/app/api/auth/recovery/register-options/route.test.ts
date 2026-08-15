import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

describe('POST /api/auth/recovery/register-options', () => {
  it('returns 503 while recovery is disabled', async () => {
    const req = new NextRequest('http://localhost/api/auth/recovery/register-options', {
      method: 'POST',
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Recovery is temporarily disabled');
  });
});
