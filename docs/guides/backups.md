# Backup and restore

The encryption key and data volume are one recovery unit. Without the original `SAD_ENCRYPTION_KEY`, stored headers, cookies, and webhook secrets cannot be decrypted.

## Consistent backup

1. Record the deployed Screenshot-a-Day version and securely copy `.env` to encrypted storage.
2. Stop the worker, then the API, so SQLite WAL state and blob references cannot change.
3. Copy the complete `/data` directory from the API volume.
4. Restart the API and worker and verify `/health/ready`.

With Compose:

```sh
docker compose stop worker api
docker compose cp api:/data ./screenshot-a-day-backup
docker compose start api worker
```

## Restore

Restore only into an empty volume using the same or a compatible newer application version. Keep the old volume until login, capture history, image reads, and one new test capture succeed. Downgrades are unsupported unless release notes explicitly state otherwise.
