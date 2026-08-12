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
- `POST /api/v1/comparisons` compares two successful captures belonging to one profile.
- `POST /api/v1/projects/{id}/profiles/{profileId}/exports` queues GIF or WebM generation.
- `POST /api/v1/projects/{id}/webhooks` creates a signed webhook and returns its secret once.
- `POST /api/v1/tokens` returns a bearer token once; `DELETE /api/v1/tokens/{id}` revokes it.

Public gallery data uses `/api/public/p/{slug}` or `/api/public/s/{share-token}`. Its public comparison route accepts two capture IDs without exposing administrative metadata. Immutable capture images and stable `latest.gif`/`latest.webm` artifacts are served beneath `/p/{slug}` and `/s/{share-token}`.

Export requests accept `frameDurationMs`, `canvasWidth`, `canvasHeight`, `timestampOverlay`, `background`, and `frameLimit`. A custom range may be selected with explicit `captureIds`, an inclusive ISO `from`/`to` window, or both; every selected capture must belong to the requested profile.

Scheduling an enabled profile normally requires a prior successful capture. Automation may set `confirmUntestedProfiles: true` in the project patch request as an explicit override; the administrator UI exposes the same confirmation separately from the enable switch.

## Compatibility

Compatible additions remain in `/api/v1`. A removal or semantic breaking change requires a parallel API version and documented migration period. Product SemVer does not silently override that promise.

Errors have an HTTP status and `{ "error": "human-readable summary" }`. Validation failures also include structured `issues`. Requests are limited to 30 MB in v0.1.0.
