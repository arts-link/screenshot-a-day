# Screenshot-a-Day

Screenshot-a-Day is a self-hosted visual history for websites. It captures reproducible screenshots on a schedule, compares changes, publishes galleries and GIF/WebM timelines, and can notify other tools through signed webhooks.

[Project website](https://arts-link.github.io/screenshot-a-day/) · [Source and releases](https://github.com/arts-link/screenshot-a-day) · [Security reporting](SECURITY.md)

Version 0.1.0 is the initial open-source release. The public demo at `https://screenshots.arts-link.com/` will be linked when the released deployment passes its launch checks. Follow the [release checklist](docs/plans/release-v0.1.0.md), read the [v0.1.0 release notes](docs/releases/v0.1.0.md), or review the [architecture decisions](docs/adr/README.md).

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
docker compose pull
docker compose up -d
docker compose logs api
```

Open [http://localhost:4400/setup](http://localhost:4400/setup) and use the one-time token from the API log. See the [deployment guide](docs/guides/deployment.md), [configuration reference](docs/configuration.md), and [security model](docs/security.md) before exposing the service publicly.

The Compose file pulls these versioned GitHub Container Registry images; Screenshot-a-Day is not published to npm or Docker Hub:

```text
ghcr.io/arts-link/screenshot-a-day-api:0.1.0
ghcr.io/arts-link/screenshot-a-day-worker:0.1.0
```

To keep the home server private while hosting galleries elsewhere, configure a portable static publication target using the [static publishing guide](docs/guides/static-publishing.md). Existing Vercel projects, Netlify sites, and dedicated SFTP roots are supported.

## Supported platforms and v0.1 limitations

Published images support Docker-compatible linux/amd64 and linux/arm64 hosts. Docker Desktop can run them on supported macOS and Windows hosts through its Linux VM.

Version 0.1 uses SQLite and a local persistent volume, supports one API replica, and has forward-only database migrations. Pixel comparisons are profile-specific and limited to 16 million decoded pixels. Operators are responsible for TLS, storage, backups, monitoring, retention, and permission to capture each target. Screenshot-a-Day includes no product telemetry. Captures are not signed, certified, or tamper-proof; “signed” refers only to outbound webhook authentication.

## Development

Requirements: Node.js 24 and pnpm 11.

```sh
pnpm install
pnpm check
pnpm dev
```

Architecture and contributor details live in the [development guide](docs/development.md). The API serves interactive OpenAPI documentation at `/docs/api`.

Contributions require a [DCO 1.1 sign-off](CONTRIBUTING.md#developer-certificate-of-origin); the project does not use a CLA. Report vulnerabilities privately as described in the [security policy](SECURITY.md).

## Versioning

The project follows [Semantic Versioning](docs/versioning.md), beginning at `0.1.0`. All application packages and container images share one version.

## License

Copyright (c) 2026 Arts-Link contributors. Screenshot-a-Day is free software licensed under the GNU Affero General Public License v3.0 or later.

The application displays a link to its [corresponding source](https://github.com/arts-link/screenshot-a-day) for remote users. There is no warranty; see [LICENSE](LICENSE).
