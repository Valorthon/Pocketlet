<!-- Target `develop`, unless this is a promotion to `stag-test` or `prod-test`. -->

## What and why

<!-- What changes, and what problem it solves. Link the issue: fixes #123 -->

## How to verify

<!-- Steps a reviewer can actually follow. Note if Postgres or a deployed contract is needed. -->

## Checklist

- [ ] `pnpm run lint` passes
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm --filter web test` passes
- [ ] `cargo test` passes (if `contracts/` changed)
- [ ] Docs updated, or N/A — see [the table in CONTRIBUTING.md](../CONTRIBUTING.md#if-you-change-x-update-y)
- [ ] No new `any`, `@ts-ignore`, or unexplained `eslint-disable`
