# Contributing

Use Node.js 22.18+ and `npm install`. Keep the utility local-first, read-only and dependency-light.

1. Add behavior-focused tests for changes. Use local RPC fixtures, never keys or funds.
2. Run `npm run format` and `npm run check`.
3. Install Chromium with `npx playwright install chromium`, then run `npm run test:e2e`.
4. Update the guide or API documentation when behavior changes.
5. Use conventional commits, for example `fix: preserve supply precision`.

Keep synthetic examples labeled in the interface and exports. Never infer token safety from a single field. Do not add wallets, transaction submission, paid services or telemetry.

Never commit secrets, `.env`, dependencies, build output or video production files. For a security issue, contact the [maintainer](https://github.com/royalpinto007) privately before sharing sensitive evidence publicly.
