import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail, verifyPinForUser } from '@/lib/auth/store';
import { keyStorage } from '@/lib/wallet/keys';
import { getUsdcContractId, getXlmContractId } from '@/lib/wallet/assets';
import { invokeWalletContract, amountToBaseUnits, i128ScVal, addressScVal } from '@/lib/wallet/invoke';
import { getTokenBalance } from '@/lib/wallet/deploy';
import { resolveRecipient } from '@/lib/wallet/recipient';

export interface TransferRequest {
  asset: 'USDC' | 'XLM';
  amount: string;
  recipient: string;
  pin: string;
}

function getTokenContractId(asset: 'USDC' | 'XLM'): string {
  return asset === 'USDC' ? getUsdcContractId() : getXlmContractId();
}

function validateAmount(amount: string): string | null {
  if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    return 'Amount must be a positive number';
  }
  const parts = amount.split('.');
  if (parts.length > 2) {
    return 'Invalid amount format';
  }
  if (parts[1] && parts[1].length > 7) {
    return 'Amount cannot have more than 7 decimal places';
  }
  return null;
}

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

  const user = getUserByEmail(session.email);
  if (!user || !user.contractId || !keyStorage.has(user.email)) {
    return NextResponse.json({ error: 'Wallet not deployed' }, { status: 404 });
  }

  let body: TransferRequest;
  try {
    body = (await request.json()) as TransferRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { asset, amount, recipient, pin } = body;

  if (!asset || (asset !== 'USDC' && asset !== 'XLM')) {
    return NextResponse.json({ error: 'Asset must be USDC or XLM' }, { status: 400 });
  }

  const amountError = validateAmount(amount);
  if (amountError) {
    return NextResponse.json({ error: amountError }, { status: 400 });
  }

  if (!recipient || typeof recipient !== 'string') {
    return NextResponse.json({ error: 'Recipient is required' }, { status: 400 });
  }

  const resolved = resolveRecipient(recipient);
  if (!resolved) {
    return NextResponse.json(
      { error: 'Recipient not found. Check the username, phone, or Stellar address.' },
      { status: 404 }
    );
  }

  if (!pin || typeof pin !== 'string') {
    return NextResponse.json({ error: 'PIN is required' }, { status: 400 });
  }

  if (!verifyPinForUser(user.email, pin)) {
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
  }

  try {
    const tokenContractId = getTokenContractId(asset);
    const baseAmount = amountToBaseUnits(amount);

    const balance = await getTokenBalance(tokenContractId, user.contractId);
    if (baseAmount > balance) {
      return NextResponse.json(
        { error: `Insufficient ${asset} balance` },
        { status: 400 }
      );
    }

    const result = await invokeWalletContract(user, 'transfer', [
      addressScVal(tokenContractId),
      addressScVal(resolved.address),
      i128ScVal(baseAmount),
    ]);

    return NextResponse.json({ hash: result.hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transfer failed';
    console.error('Transfer failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
