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

1. Stop the installation and move its current named volume aside rather than deleting it.
2. Create a fresh empty volume and a stopped API container using the same release and `.env` file.
3. Copy the contents of `screenshot-a-day-backup` into `/data`; the restored directory must contain `sad.sqlite` and `blobs/` directly.
4. Start only the API and verify SQLite before starting the worker:

```sh
docker compose down
docker compose --project-name screenshot-a-day-restore create api
docker compose --project-name screenshot-a-day-restore cp ./screenshot-a-day-backup/. api:/data
docker compose --project-name screenshot-a-day-restore run --rm --no-deps --user root api chown -R node:node /data
docker compose --project-name screenshot-a-day-restore start api
docker compose --project-name screenshot-a-day-restore exec api node --input-type=module -e "import Database from 'better-sqlite3'; const db=new Database('/data/sad.sqlite',{readonly:true}); console.log(db.pragma('integrity_check',{simple:true})); db.close()"
curl --fail http://localhost:${SAD_HOST_PORT:-4400}/health/ready
docker compose --project-name screenshot-a-day-restore start worker
```

If the integrity check does not print `ok`, stop and keep both the backup and old volume unchanged. After a successful check, sign in and verify an old full-size image, an old thumbnail, comparison history, and one new capture in each enabled browser profile. Retain the previous volume until those checks pass.

The restore rehearsal uses the separate `screenshot-a-day-restore` Compose project and therefore a separate empty named volume. Keep the prior project and volume until the restored installation passes every check. For a permanent replacement, either retain the restored Compose project name or copy the verified data into the normal project's empty volume during a final stopped maintenance window.
