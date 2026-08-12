# Webhooks

Projects may emit `capture.changed` after successful comparisons and `capture.failed` after the third failed attempt. A changed delivery is created only when its percentage meets the webhook threshold.

Payloads include `schemaVersion`, `productVersion`, `event`, project/profile/run/capture IDs, capture time, and event-specific change or error fields. Schema version `1` is the v0.1.0 contract.

Requests include:

- `X-SAD-Event`
- `X-SAD-Timestamp` as Unix seconds
- `X-SAD-Signature: sha256=<hex digest>`

Verify the HMAC-SHA256 over `<timestamp>.<raw request body>` with the secret shown once at creation. Reject stale timestamps before performing a constant-time signature comparison.

Failed deliveries retry up to five times with exponential backoff. Operators can inspect delivery state in SQLite logs; a delivery replay UI is deferred.
