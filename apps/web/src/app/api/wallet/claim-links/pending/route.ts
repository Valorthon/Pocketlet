import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail } from '@/lib/auth/store';
import { db, schema } from '@/lib/db';
import { eq, and, or } from 'drizzle-orm';

export async function GET() {
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

  const conditions = [eq(schema.claimLinks.status, 'pending')];

  if (user.phone) {
    conditions.push(eq(schema.claimLinks.recipientPhone, user.phone));
  }
  if (user.email) {
    conditions.push(eq(schema.claimLinks.recipientEmail, user.email));
  }

  if (conditions.length === 1) {
    return NextResponse.json({ claims: [] });
  }

  const rows = await db
    .select()
    .from(schema.claimLinks)
    .where(and(conditions[0], or(...conditions.slice(1))));

  const claims = rows.map((row) => ({
    id: row.id,
    senderEmail: row.senderEmail,
    tokenContractId: row.tokenContractId,
    amount: row.amount,
    expiry: row.expiry.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));

  return NextResponse.json({ claims });
}
