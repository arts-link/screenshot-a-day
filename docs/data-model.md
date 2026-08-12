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

Migration `1` creates the v0.1.0 schema. Migrations are forward-only and recorded in `schema_migrations`. Blob keys are opaque application data and should not be constructed by integrations.
