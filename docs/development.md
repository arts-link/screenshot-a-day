# Development guide

Source development, CI, and release builds use Node 24 LTS and the pnpm version declared
in `package.json`. Docker deployments do not require a host Node.js installation. The
root `.mise.toml`, `.nvmrc`, and `.node-version` select the supported Node.js runtime
without changing a developer's global default. Corepack reads `packageManager` from
`package.json` and activates the exact pnpm release.

With mise:

```sh
mise trust
mise install
mise exec -- corepack enable
mise exec -- zsh
node --version
pnpm --version
```

Review the two-line `.mise.toml` before trusting it. With nvm, run `nvm install`,
`nvm use`, and `corepack enable`. The runtime guard intentionally stops source commands
on an untested Node.js major instead of allowing a later native-addon failure.

```sh
pnpm install
pnpm check
pnpm build
```

Do not reuse native dependencies across Node.js majors. If `better-sqlite3` reports a
`NODE_MODULE_VERSION` mismatch after switching runtimes, repair the checkout under Node
24 and rerun the failed command:

```sh
pnpm --filter @sad/api rebuild better-sqlite3
```

For local development, export the required values from `.env.example`, run `pnpm dev`, and open Vite at port 5173. Vite proxies API calls to port 4400. Playwright browser binaries are available in the worker image; local cross-browser work may require `pnpm --filter @sad/worker exec playwright install`.

Tests use deterministic in-process Fastify injection and generated images. Do not point tests at private or third-party pages. Changes to contracts require corresponding API, worker, UI, docs, and compatibility updates.
