# Screenshot-a-Day

Screenshot-a-Day is a self-hosted visual history for websites. It captures reproducible screenshots on a schedule, compares changes, publishes galleries and GIF/WebM timelines, and can notify other tools through signed webhooks.

The first release is under active development. Follow the [v0.1.0 implementation plan](docs/plans/v0.1.0.md) and [architecture decisions](docs/adr/README.md).

## Quick start

Requirements: Docker with Compose and OpenSSL.

```sh
cp .env.example .env
openssl rand -base64 32
openssl rand -hex 32
openssl rand -hex 32
```

Put those three values into `SAD_ENCRYPTION_KEY`, `SAD_SESSION_SECRET`, and `SAD_WORKER_TOKEN`, then run:

```sh
chmod 600 .env
docker compose up -d
docker compose logs api
```

Open [http://localhost:4400/setup](http://localhost:4400/setup) and use the one-time token from the API log. See the [deployment guide](docs/guides/deployment.md), [configuration reference](docs/configuration.md), and [security model](docs/security.md) before exposing the service publicly.

## Development

Requirements: Node.js 24 and pnpm 11.

```sh
pnpm install
pnpm check
pnpm dev
```

Architecture and contributor details live in the [development guide](docs/development.md). The API serves interactive OpenAPI documentation at `/docs/api`.

## Versioning

The project follows [Semantic Versioning](docs/versioning.md), beginning at `0.1.0`. All application packages and container images share one version.

## License

Copyright (c) 2026 Arts-Link contributors. Screenshot-a-Day is free software licensed under the GNU Affero General Public License v3.0 or later.

The application displays a link to its [corresponding source](https://github.com/arts-link/screenshot-a-day) for remote users. There is no warranty; see [LICENSE](LICENSE).
