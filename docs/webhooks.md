# Webhooks

Projects may emit `capture.changed` after successful comparisons and `capture.failed` after the third failed attempt. A changed delivery is created only when its percentage meets the webhook threshold. An administrator may also queue a signed `webhook.test` diagnostic event from Configuration; it is never emitted automatically.

Payloads include `schemaVersion`, `productVersion`, `event`, project/profile/run/capture IDs, capture time, and event-specific change or error fields. Schema version `1` is the v0.1.0 contract.

Requests include:

- `X-SAD-Event`
- `X-SAD-Timestamp` as Unix seconds
- `X-SAD-Signature: sha256=<hex digest>`

Verify the HMAC-SHA256 over `<timestamp>.<raw request body>` with the secret shown once at creation. Reject stale timestamps before performing a constant-time signature comparison.

Failed deliveries retry up to five times with exponential backoff. Configuration shows recent delivery status, response status, attempts, and final errors. Pausing a webhook prevents queued work from being claimed; deleting it cascades its queued and retained delivery history. Rotating a signing secret invalidates the prior secret immediately and displays the replacement once.
