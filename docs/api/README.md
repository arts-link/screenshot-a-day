# REST API

Interactive OpenAPI documentation is served at `/docs/api`. Stable automation routes use `/api/v1`; `/internal/v1` is a lockstep worker protocol, not a public integration contract.

Create a scoped token in Settings or with `POST /api/v1/tokens`. Token values are displayed once.

```sh
curl --fail --request POST \
  --header "Authorization: Bearer $SAD_API_TOKEN" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: deploy-$GITHUB_SHA" \
  --data '{}' \
  "https://sad.example.com/api/v1/projects/PROJECT_ID/runs"
```

Scopes are `read`, `capture:trigger`, and `manage`. A token may be limited to specific project IDs. Reusing an idempotency key for the same project returns the original run.

## Resources

The authenticated API includes projects, profiles, runs, captures, comparisons, exports, webhooks, API tokens, and storage summaries. Notable state-changing routes are:

- `POST /api/v1/projects` and `PATCH /api/v1/projects/{id}` create and configure projects.
- `PUT /api/v1/projects/{id}/credentials` replaces all encrypted target headers and cookies. Secrets are write-only.
- `POST`, `PUT`, and `DELETE /api/v1/projects/{id}/profiles/...` manage capture profiles. Editing a profile clears its successful-test state.
- `POST /api/v1/projects/{id}/runs` creates an idempotent batch across selected enabled profiles.
- `POST /api/v1/comparisons` compares two distinct successful captures belonging to one project and profile. Decoded comparisons are limited to 16 million pixels.
- `POST /api/v1/projects/{id}/profiles/{profileId}/exports` queues GIF or WebM generation. `GET` on the same collection reports unavailable, queued, processing, succeeded, or failed state for both formats; `GET .../exports/{format}` downloads the latest completed artifact.
- `POST /api/v1/projects/{id}/webhooks` creates a signed webhook and returns its secret once. Webhook update, pause, deletion, secret rotation, signed test delivery, and recent delivery history are available below that webhook resource.
- `POST /api/v1/tokens` returns a bearer token once; `DELETE /api/v1/tokens/{id}` revokes it.

Public gallery data uses `/api/public/p/{slug}` or `/api/public/s/{share-token}`. Its public comparison route accepts two capture IDs without exposing administrative metadata. Immutable capture images and stable `latest.gif`/`latest.webm` artifacts are served beneath `/p/{slug}` and `/s/{share-token}`. Gallery data includes export availability, progress, frame counts, timestamps, and download URLs; generation errors remain administrative.

Capture history is newest-first. `GET /api/v1/projects/{id}/captures` accepts `profileId`, `status=all|succeeded|failed`, `limit` from 1 through 500, and a non-negative `offset`. Its array response is unchanged; `X-Total-Count`, `X-Successful-Count`, and `X-Failed-Count` provide exact pagination totals. Built-in public galleries accept `profileId` and a one-based `page`, returning 12 successful captures plus successful/failed totals.

Export requests accept `frameDurationMs`, `canvasWidth`, `canvasHeight`, `timestampOverlay`, `background`, and `frameLimit`. A custom range may be selected with explicit `captureIds`, an inclusive ISO `from`/`to` window, or both; every selected capture must belong to the requested profile.

Generation is asynchronous and server-side. A worker downloads the selected screenshots, normalizes them with Sharp, invokes FFmpeg, and uploads the completed artifact. Public projects automatically queue both formats after a successful capture once at least two frames exist. Download routes never generate on demand: they return the last completed artifact or `404` when none exists.

Scheduling an enabled profile normally requires a prior successful capture. Automation may set `confirmUntestedProfiles: true` in the project patch request as an explicit override; the administrator UI exposes the same confirmation separately from the enable switch.

## Compatibility

Compatible additions remain in `/api/v1`. A removal or semantic breaking change requires a parallel API version and documented migration period. Product SemVer does not silently override that promise.

Errors have an HTTP status and `{ "error": "human-readable summary" }`. Validation failures also include structured `issues`. Comparison capacity uses `429` for rate limits, `422` for oversized decoded images, and `503` with `Retry-After` when the bounded comparison queue is full. Requests are limited to 30 MB in v0.1.0.
