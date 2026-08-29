#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NETWORK="${STELLAR_NETWORK:-testnet}"
DEPLOYER_KEY_NAME="${STELLAR_DEPLOYER_KEY_NAME:-deployer}"
WASM_PATH="target/wasm32v1-none/release/pocketlet_escrow.wasm"

echo "==> Building contract..."
stellar contract build

if [ ! -f "$WASM_PATH" ]; then
  echo "Error: WASM not found at $WASM_PATH"
  exit 1
fi

echo "==> WASM built: $WASM_PATH"

if [ -n "${STELLAR_DEPLOYER_SECRET:-}" ]; then
  echo "==> Using provided deployer secret..."
  stellar keys add "$DEPLOYER_KEY_NAME" --secret-key "$STELLAR_DEPLOYER_SECRET"
else
  echo "==> Generating deployer key..."
  stellar keys generate "$DEPLOYER_KEY_NAME" || true
  echo "==> Funding deployer key..."
  stellar keys fund "$DEPLOYER_KEY_NAME" --network "$NETWORK" || true
fi

echo "==> Deploying to $NETWORK..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --source-account "$DEPLOYER_KEY_NAME" \
  --network "$NETWORK")

echo ""
echo "==> Contract deployed successfully!"
echo "    Network: $NETWORK"
echo "    Address: $CONTRACT_ID"
echo ""
echo "    Add this to your .env file:"
echo "    NEXT_PUBLIC_ESCROW_CONTRACT_ID=$CONTRACT_ID"
