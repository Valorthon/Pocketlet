import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail } from '@/lib/auth/store';
import { decryptSecret } from '@/lib/wallet/claim-secrets';
import { db, schema } from '@/lib/db';
import { eq, and, or } from 'drizzle-orm';

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

  const user = await getUserByEmail(session.email);
  if (!user || !user.walletContractId) {
    return NextResponse.json({ error: 'Wallet not deployed' }, { status: 404 });
  }

  let body: { claimLinkId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { claimLinkId } = body;
  if (!claimLinkId) {
    return NextResponse.json({ error: 'claimLinkId is required' }, { status: 400 });
  }

  const conditions = [
    eq(schema.claimLinks.id, claimLinkId),
    eq(schema.claimLinks.status, 'pending'),
  ];

  const recipientConditions = [];
  if (user.phone) {
    recipientConditions.push(eq(schema.claimLinks.recipientPhone, user.phone));
  }
  if (user.email) {
    recipientConditions.push(eq(schema.claimLinks.recipientEmail, user.email));
  }

  if (recipientConditions.length === 0) {
    return NextResponse.json(
      { error: 'Your account has no phone or email to match against' },
      { status: 403 }
    );
  }

  const [link] = await db
    .select()
    .from(schema.claimLinks)
    .where(and(...conditions, or(...recipientConditions)));

  if (!link) {
    return NextResponse.json(
      { error: 'Claim link not found or not available to you' },
      { status: 404 }
    );
  }

  if (new Date() > link.expiry) {
    return NextResponse.json(
      { error: 'Claim link has expired' },
      { status: 410 }
    );
  }

  try {
    const secret = decryptSecret(link.secretCiphertext);
    return NextResponse.json({ secret, claimHash: link.claimHash, amount: link.amount, tokenContractId: link.tokenContractId });
  } catch {
    return NextResponse.json(
      { error: 'Failed to decrypt claim secret' },
      { status: 500 }
    );
  }
}
