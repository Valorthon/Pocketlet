import { Keypair, rpc } from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { getUserByEmail, setWallet } from '@/lib/auth/store';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import {
  deployWallet,
  fundAccount,
  getPlatformKeypair,
  RPC_URL,
} from '@/lib/wallet/deploy';
import { keyStorage } from '@/lib/wallet/keys';

interface WalletInfo {
  contractId: string;
  stellarAddress: string;
}

export async function POST(request: NextRequest) {
  const cookieStore = request.cookies;
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = getUserByEmail(session.email);
  if (!user || !user.credential) {
    return NextResponse.json({ error: 'User not found or passkey not registered' }, { status: 404 });
  }

  if (user.contractId) {
    return NextResponse.json({
      email: user.email,
      contractId: user.contractId,
      stellarAddress: user.stellarAddress,
    });
  }

  try {
    const server = new rpc.Server(RPC_URL);
    const deployer = getPlatformKeypair();
    await fundAccount(deployer.publicKey());

    const ownerKeypair = Keypair.random();
    const ownerPublicKey = Buffer.from(ownerKeypair.rawPublicKey());
    const contractAddress = await deployWallet(server, deployer, ownerPublicKey);

    const walletInfo: WalletInfo = {
      contractId: contractAddress,
      stellarAddress: contractAddress,
    };

    keyStorage.store(user.email, ownerKeypair.secret());
    const updated = setWallet(user.email, walletInfo);
    return NextResponse.json({
      email: updated.email,
      contractId: updated.contractId,
      stellarAddress: updated.stellarAddress,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Wallet deployment failed';
    console.error('Wallet deployment failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
