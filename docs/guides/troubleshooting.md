# Troubleshooting

## No setup token

Setup tokens appear only when no administrator exists. Use the administrator recovery command for an existing installation. An unconfigured restart issues a new 15-minute token.

## Capture remains queued

Check that a worker is running, uses the same `SAD_WORKER_TOKEN`, and can reach the API URL. Jobs become claimable again after a lease expires. Browser failures receive three attempts with bounded backoff.

## Target is blocked

The worker blocks private and special-purpose addresses by design. Confirm DNS answers from the worker network. Add a narrow exact hostname to `SAD_PRIVATE_TARGET_ALLOWLIST` only when internal capture is intentional.

## Scheduling cannot be enabled

Every enabled profile must have one successful test capture. Editing a profile clears its tested state because the rendering conditions changed.

## GIF/WebM export fails

Confirm the worker image contains FFmpeg and that at least two successful frames exist. The last valid public artifact remains available while regeneration retries or fails.

Generation runs asynchronously in the worker, not in the browser or during download. The Compare page reports queued, encoding, success, and failure state and can be left safely while work continues. Public gallery controls download only the latest completed file; an unavailable control means no successful artifact exists yet. Check worker logs when a job remains queued or reports an FFmpeg failure.

## Encryption errors after restore

The restored `SAD_ENCRYPTION_KEY` does not match the data. Stop the API and recover the original key; repeatedly rewriting configuration cannot repair encrypted values.
