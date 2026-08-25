import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { verifySessionToken } from '@/lib/auth/session';
import { getUserByEmail, setProfile, type ProfileUpdate } from '@/lib/auth/store';

export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await getUserByEmail(session.email);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  let body: { username?: unknown; phone?: unknown };
  try {
    body = (await request.json()) as { username?: unknown; phone?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const profile: ProfileUpdate = {};
  if ('username' in body) {
    profile.username = typeof body.username === 'string' ? body.username : null;
  }
  if ('phone' in body) {
    profile.phone = typeof body.phone === 'string' ? body.phone : null;
  }

  try {
    const updated = await setProfile(user.email, profile);
    return NextResponse.json({
      email: updated.email,
      username: updated.username,
      phone: updated.phone,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Profile update failed';
    if (
      message.includes('Username must be') ||
      message.includes('Phone number must include')
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes('already')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
