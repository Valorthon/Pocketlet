import { NextRequest, NextResponse } from 'next/server';
import { createUser, getUserByEmail } from '@/lib/auth/store';
import { incrementMetric } from '@/lib/metrics';
import { RP_ID } from '@/lib/auth/config';

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: string };
  const email = body.email?.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
  }

  const code = generateCode();
  await createUser(email, code);
  await incrementMetric('auth.signup.completed');

  // Testnet only: return the code so the user can verify without a mail server.
  // In production, send this via email and do not return it in the response.
  return NextResponse.json({
    email,
    code,
    message: 'Verification code generated. In production this will be sent via email.',
  });
}

export function GET() {
  return NextResponse.json({
    rpId: RP_ID,
    message: 'POST an email to this endpoint to start registration.',
  });
}
