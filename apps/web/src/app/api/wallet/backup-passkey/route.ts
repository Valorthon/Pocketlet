import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail, setBackupPasskey } from '@/lib/auth/store';

export interface BackupPasskeyRequest {
  /** Base64URL-encoded credential id of the backup passkey. */
  keyIdBase64: string;
}

/**
 * Record that the user has registered a backup passkey.
 *
 * The on-chain signer registration is performed client-side with the primary
 * passkey; this endpoint only updates the user record.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = getUserByEmail(session.email);
  if (!user || !user.walletContractId) {
    return NextResponse.json({ error: 'Wallet not deployed' }, { status: 404 });
  }

  let body: BackupPasskeyRequest;
  try {
    body = (await request.json()) as BackupPasskeyRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { keyIdBase64 } = body;
  if (!keyIdBase64 || typeof keyIdBase64 !== 'string') {
    return NextResponse.json({ error: 'keyIdBase64 is required' }, { status: 400 });
  }

  setBackupPasskey(user.email, { keyIdBase64 });
  return NextResponse.json({ success: true });
}
