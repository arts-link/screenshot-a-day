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

## Guarded release rehearsal

From the checkout whose Compose images will receive the restored data, the release helper automates the stopped backup, isolated restore, ownership normalization, readiness check, SQLite integrity check, and retained-PNG digest check. It then waits while you sign in and run one fresh batch containing enabled Chromium, Firefox, and WebKit profiles. It writes a timestamped JSON evidence file without reading or recording secret values.

Load the source deployment's `.env` values into the shell first. The custody reference must name where the original encryption key is stored, never the key itself. Both the backup directory and restore Compose project must be new, and the restore port must be unused.

```sh
pnpm release:restore-rehearsal -- \
  --source-project screenshot-a-day-v010-rc2 \
  --restore-project screenshot-a-day-v010-final-restore \
  --source-port 4400 \
  --restore-port 4401 \
  --restore-url http://your-server:4401 \
  --backup-dir /srv/backups/screenshot-a-day-v010-rc2-YYYYMMDD \
  --source-sha "$RC2_SHA" \
  --expected-sha "$SAD_RELEASE_SHA" \
  --key-custody-reference "Password manager item: Screenshot-a-Day production"
```

The source API and worker stop only for the copy and are restarted even if copying fails. The command refuses an existing restore container or named volume, a port collision, a broad or existing backup path, matching source/restore names, and an unexpected source or restored `/version` commit. It never deletes the source volume or backup. By default it also retains the successful restore deployment for inspection; pass `--cleanup` only when you want the successfully verified disposable restore project and its volume removed.

Use `--skip-capture` only to finish the automated half while leaving the fresh three-browser result explicitly pending in the evidence. It cannot be combined with `--cleanup`.
