import { NextRequest, NextResponse } from 'next/server';

/**
 * Lost-passkey recovery is disabled in Phase 1a. It will be rebuilt in Phase 1b
 * using a BIP39 recovery phrase and optional backup passkey instead of a
 * platform recovery admin.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _req: NextRequest
): Promise<NextResponse> {
  return NextResponse.json(
    {
      error:
        'Recovery is temporarily disabled while it is rebuilt for the passkey-kit wallet.',
    },
    { status: 503 }
  );
}
