# Development guide

Use Node 24 and the pnpm version declared in `package.json`.

```sh
pnpm install
pnpm check
pnpm build
```

For local development, export the required values from `.env.example`, run `pnpm dev`, and open Vite at port 5173. Vite proxies API calls to port 4400. Playwright browser binaries are available in the worker image; local cross-browser work may require `pnpm --filter @sad/worker exec playwright install`.

Tests use deterministic in-process Fastify injection and generated images. Do not point tests at private or third-party pages. Changes to contracts require corresponding API, worker, UI, docs, and compatibility updates.
