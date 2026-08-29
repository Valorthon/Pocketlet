import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getUserByEmail, setPendingChallenge } from '@/lib/auth/store';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: string };
  const email = body.email?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const user = await getUserByEmail(email);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const challenge = randomBytes(32).toString('base64');
  await setPendingChallenge(email, challenge);

  return NextResponse.json({ challenge });
}
