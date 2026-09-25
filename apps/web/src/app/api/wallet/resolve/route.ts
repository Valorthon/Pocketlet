import { NextRequest, NextResponse } from 'next/server';
import { requireSessionEmail } from '@/lib/auth/route-guard';
import { enforceResolveRateLimit } from '@/lib/rate-limit';
import { resolveRecipient } from '@/lib/wallet/recipient';
import { validateRecipientFormat, isValidPhoneFormat, isValidEmailFormat } from '@/lib/wallet/recipient-format';

export async function POST(request: NextRequest) {
  const guard = await requireSessionEmail();
  if (!guard.ok) {
    return guard.response;
  }
  const email = guard.value;

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

  // This route spends no fee-payer funds, so the limit is far looser than the
  // submission routes'. It still needs one: a 200 here means the identifier
  // belongs to a registered account and a 404 means it does not, which is a
  // user-directory oracle for anyone with a session (#36, after #110).
  const limited = await enforceResolveRateLimit(request, email);
  if (limited) {
    return limited;
  }

  const resolved = await resolveRecipient(recipient);
  if (resolved) {
    return NextResponse.json(resolved);
  }

  // Recipient not found in the database — if it's a phone or email, offer a claim link
  const isPhone = isValidPhoneFormat(recipient);
  const isEmail = isValidEmailFormat(recipient);

  if (isPhone || isEmail) {
    return NextResponse.json(
      { found: false, unregistered: true, identifier: recipient, type: isPhone ? 'phone' : 'email' },
      { status: 404 }
    );
  }

  return NextResponse.json(
    { error: 'Recipient not found. Check the username, phone, or Stellar address.' },
    { status: 404 }
  );
}
