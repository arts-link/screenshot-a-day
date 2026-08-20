# Configuration reference

The API refuses to start without three independent secrets. Put them in `.env` for Compose, give the file mode `0600`, and preserve `SAD_ENCRYPTION_KEY` in backups.

| Variable                            | Service           | Default                 | Purpose                                                                            |
| ----------------------------------- | ----------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `SAD_ENCRYPTION_KEY`                | API               | required                | Exactly 32 random bytes encoded as Base64; encrypts target and webhook secrets     |
| `SAD_SESSION_SECRET`                | API               | required                | At least 32 characters; protects signed cookie handling                            |
| `SAD_WORKER_TOKEN`                  | both              | required                | At least 32 characters and identical in API and worker                             |
| `SAD_PUBLIC_URL`                    | API               | `http://localhost:4400` | External origin used for cookies, worker artifact URLs, and webhook links          |
| `SAD_DATA_DIR`                      | API               | `./data`                | SQLite and blob root; `/data` in Compose                                           |
| `SAD_PORT`                          | API               | `4400`                  | HTTP listen port                                                                   |
| `SAD_TRUST_PROXY`                   | API               | `false`                 | Trust forwarding headers only behind a controlled reverse proxy                    |
| `SAD_PRIVATE_TARGET_ALLOWLIST`      | both through jobs | empty                   | Comma-separated exact hosts, wildcard domains, IPs, or CIDRs intentionally allowed |
| `SAD_WORKER_CONCURRENCY`            | worker            | `1`                     | Parallel browser/export jobs per worker                                            |
| `SAD_WORKER_POLL_MS`                | worker            | `2000`                  | Delay between empty queue polls                                                    |
| `SAD_FFMPEG_PATH`                   | worker            | `ffmpeg`                | Export encoder executable                                                          |
| `SAD_LOG_LEVEL`                     | API               | `info`                  | Pino log level                                                                     |
| `SAD_BUILD_COMMIT`                  | both/images       | `development`           | Source revision exposed in diagnostics                                             |
| `SAD_HUGO_PATH`                     | API               | `hugo`                  | Hugo executable; the API image pins Hugo Extended 0.146.2                          |
| `SAD_RYDER_PATH`                    | API               | `/opt/sad/ryder`        | Ryder v0.4.1 theme directory bundled in the API image                              |
| `SAD_PUBLICATION_BUILD_TIMEOUT_MS`  | API               | `300000`                | Timeout for the single concurrent static build                                     |
| `SAD_PUBLICATION_DEPLOY_TIMEOUT_MS` | API               | `600000`                | Overall timeout for a static deployment                                            |

Changing the encryption key makes existing encrypted target credentials and webhook secrets unreadable. Rotating it therefore requires a migration tool that is not included in v0.1.0.

## Schedules

New projects use an inactive daily schedule (`0 0 * * *`) in UTC. The UI provides daily, six-hourly, and weekly presets plus direct cron editing. Cron expressions are evaluated in the project's IANA timezone. Scheduling normally requires a successful test capture for every enabled profile; bypassing that guard requires a separate explicit confirmation.

Static publication cadence is configured per target because one deployment contains all attached projects. Manual, debounced on-change, hourly, daily, weekly, and custom cron modes are available. Scheduled builds wait for attached projects' capture and export work to finish.

## Private targets

Private, loopback, link-local, reserved, and cloud-metadata addresses are denied by default. To capture an intentional internal host, prefer an exact hostname:

```dotenv
SAD_PRIVATE_TARGET_ALLOWLIST=status.internal.example
```

CIDR and `*.example.internal` entries are supported. Every DNS result and browser request is checked; allow only the narrowest destinations needed.
