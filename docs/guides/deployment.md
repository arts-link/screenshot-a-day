# Deployment guide

## Docker Compose

```sh
cp .env.example .env
openssl rand -base64 32
openssl rand -hex 32
openssl rand -hex 32
```

Put each generated value in the corresponding `.env` variable, then:

```sh
chmod 600 .env
docker compose up -d
docker compose logs api
```

Open `http://localhost:4400/setup` and paste the logged setup token. The token expires after 15 minutes; restart an unconfigured API container to issue another.

## HTTPS proxy

Terminate TLS at a reverse proxy, forward to API port 4400, preserve the `Host` header, set `SAD_PUBLIC_URL` to the external HTTPS origin, and set `SAD_TRUST_PROXY=true` only when traffic cannot bypass that proxy. Limit request bodies to at least 30 MB for screenshot uploads from a separately networked worker.

## Scaling workers

The API is single-instance in v0.1.0 because it owns SQLite and scheduling. Workers are stateless and may scale independently:

```sh
docker compose up -d --scale worker=3
```

Keep per-worker concurrency low until browser memory usage has been measured for the target profiles.

## Administrator recovery

```sh
docker compose exec api node dist/admin.js recovery-token
```

Submit that 15-minute token and a new password to `POST /api/v1/auth/recover`. Recovery invalidates the token after one use.
