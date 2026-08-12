# ADR 0003: Use an authenticated leased-job protocol

Status: accepted

Workers claim jobs from the API with a lease, upload artifacts, and report idempotent results. Expired leases are retryable. Scheduled overlap is coalesced per project. Workers never access SQLite or the durable data volume directly.
