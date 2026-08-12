# ADR 0002: Use SQLite and local blob storage

Status: accepted

The API is the only SQLite client and uses WAL mode. Captures live in local storage behind a `BlobStore` contract. This makes the default Compose installation small while allowing future Postgres and object-storage implementations without placing either in v0.1.0 scope.
