import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

describe('GET /api/auth/recovery/status', () => {
  it('returns 503 while recovery is disabled', async () => {
    const req = new NextRequest('http://localhost/api/auth/recovery/status');
    const res = await GET(req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Recovery is temporarily disabled');
  });
});
