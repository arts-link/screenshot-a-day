# Data model

SQLite is the metadata source of truth. The API enables foreign keys, WAL mode, and a five-second busy timeout. Only the API process opens the database.

- `users`, `sessions`, and `api_tokens` implement the single-administrator security boundary.
- `projects` own targets, scheduling, retention, publication, and encrypted credentials.
- `profiles` define reproducible Playwright rendering environments.
- `runs` group work requested manually, by API, or by the scheduler.
- `jobs` are leased capture/export units with attempts, availability, and expiry.
- `captures` point to immutable original, thumbnail, and optional diff blobs.
- `exports` point to replaceable stable GIF/WebM artifacts.
- `webhooks` and `webhook_deliveries` retain signed delivery configuration and retry state.
- `publication_targets` contain non-secret adapter configuration, encrypted credentials, branding, schedule policy, and dirty/published revisions.
- `project_publications` attach at most one target to a project and retain fallback, active, and removal state.
- `publication_jobs` are target-scoped leased build/deploy operations with five transient retries.
- `publication_manifests` audit successful deployments and bound SFTP cleanup to files managed by Screenshot-a-Day.

Migration `1` creates the v0.1.0 schema. Forward migration `2` adds portable static publishing without changing existing built-in gallery behavior. Migrations are forward-only and recorded in `schema_migrations`. Blob keys are opaque application data and should not be constructed by integrations.
