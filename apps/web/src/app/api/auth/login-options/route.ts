import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { NextRequest, NextResponse } from 'next/server';
import { RP_ID } from '@/lib/auth/config';
import { getUserByEmail, setPendingChallenge } from '@/lib/auth/store';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: string };
  const email = body.email?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const user = await getUserByEmail(email);
  if (!user || !user.credential) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] = [
    {
      id: user.credential.id,
      transports: user.credential.transports as AuthenticatorTransportFuture[] | undefined,
    },
  ];

  if (user.hasBackupPasskey && user.backupCredential) {
    allowCredentials.push({
      id: user.backupCredential.id,
      transports: user.backupCredential.transports as AuthenticatorTransportFuture[] | undefined,
    });
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials,
    userVerification: 'preferred',
  });

  await setPendingChallenge(email, options.challenge);

  return NextResponse.json(options);
}
