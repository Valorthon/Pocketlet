# Agent Instructions

Read this file, `SPEC.md`, `FUTURE_VERSIONS.md`, `README.md`, and `TESTNET.md` before any planning or coding. The monorepo structure is scaffolded and the project is in active V1 development.

## Primary Directives

- **Read `SPEC.md` and `FUTURE_VERSIONS.md` first.** V1 is scoped to testnet, abstracted passkey custody, USDC/XLM only, and P2P transfers. DEX swaps are stubbed/hidden in this migration and deferred to a future version. V1 is positioned as a global wallet; fiat/Anchor/QR Ph features are deferred to V2 (Philippines) and multi-stablecoin support is deferred to V3.
- **Package manager is `pnpm`.** Do not use `npm`, `yarn`, or `bun`. Use `pnpm install` and `pnpm run <script>`.
- **Verify before assuming structure.** The monorepo (`pnpm-workspace.yaml`, `apps/`, and `packages/`) is present. If a file conflicts with these instructions, trust the executable source and update this file.

## Planned Monorepo Layout

```
/apps/web              Next.js frontend (PWA, App Router)
/packages/config       Shared ESLint, TypeScript, Tailwind config
```

Use `pnpm --filter <workspace-name>` to target packages. For example, add a dependency to the web app with `pnpm --filter web add <pkg>`. Verify the workspace name in `pnpm-workspace.yaml` and each package's `package.json` before using filter names.

## Frontend Standards (`/apps/web`)

- TypeScript only. No `any` or `@ts-ignore`.
- Next.js App Router with React Server Components; use Tailwind CSS for styling. Avoid custom CSS files unless there is no Tailwind equivalent.
- Keep UI state in React hooks/props or server-derived state. Introduce a global client store only when multiple pages need shared, client-only data.
- Hide blockchain details in normal UI: public keys, gas fees, and crypto jargon should only appear in the "Transaction Details" view. Self-custody views are planned for V2.

## Passkey Kit Standards (`/apps/web/src/lib/wallet`)

- Self-custodial passkey smart accounts via [`passkey-kit`](https://github.com/stellar/passkey-kit). The platform never holds user signing keys.
- Browser code imports from `passkey-kit` and `passkey-kit/storage`. Server-side transaction submission currently uses `@stellar/stellar-sdk` directly; only import from `passkey-kit/server` if a future server-side operation specifically requires it, so relayer secrets stay out of the client bundle.
- Testnet V1 uses a server-held fee payer that rebuilds user-authorized `invoke_host_function` operations with itself as the source account, re-simulates for current resource fees, signs the envelope, and submits directly to Soroban RPC. OpenZeppelin Channels fee sponsorship is deferred until the relayer supports CAP-0071-02 V2 address credentials; production will use a self-hosted relayer with its API key stored in a secrets manager.
- V1 does not integrate off-chain Anchors. Follow SEP-10 (auth), SEP-24 (on/off-ramp), and SEP-38 (quotes) only when implementing V2 fiat/Anchor features.

## Execution Workflow

1. Read `SPEC.md` and `FUTURE_VERSIONS.md` first.
2. State a brief plan before writing large code blocks.
3. Use `pnpm --filter <workspace>` for package-specific installs and scripts.
4. Add tests for critical logic with `vitest` for TypeScript.
5. Verify by running the package's lint, typecheck, and test commands in the intended order.

## Trust

If this file conflicts with the actual repo config, scripts, or lockfiles, trust the executable source and update this file.
