import { NextResponse } from 'next/server';

/**
 * Lost-passkey recovery is disabled in Phase 1a. It will be rebuilt in Phase 1b
 * using a BIP39 recovery phrase and optional backup passkey instead of a
 * platform recovery admin.
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error:
        'Recovery is temporarily disabled while it is rebuilt for the passkey-kit wallet.',
    },
    { status: 503 }
  );
}
