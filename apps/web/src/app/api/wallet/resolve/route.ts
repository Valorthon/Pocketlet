import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { verifySessionToken } from '@/lib/auth/session';
import { resolveRecipient } from '@/lib/wallet/recipient';
import { validateRecipientFormat } from '@/lib/wallet/recipient-format';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { recipient?: unknown };
  try {
    body = (await request.json()) as { recipient?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '';
  if (!recipient) {
    return NextResponse.json({ error: 'Recipient is required' }, { status: 400 });
  }

  const formatError = validateRecipientFormat(recipient);
  if (formatError) {
    return NextResponse.json({ error: formatError }, { status: 400 });
  }

  const resolved = resolveRecipient(recipient);
  if (!resolved) {
    return NextResponse.json(
      { error: 'Recipient not found. Check the username, phone, or Stellar address.' },
      { status: 404 }
    );
  }

  return NextResponse.json(resolved);
}
