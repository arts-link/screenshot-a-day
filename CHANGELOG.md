# Changelog

All notable changes to Screenshot-a-Day are documented here. The project follows Semantic Versioning.

## 0.1.0 - Unreleased

### Added

- Initial self-hosted API, browser worker, administrator UI, and public galleries.
- Cross-browser capture profiles, schedules, retained history, comparisons, GIF/WebM exports, and signed webhooks.
- Docker Compose deployment, documented security controls, OpenAPI documentation, and coordinated semantic releases.
- Portable static publication to Vercel, Netlify, and SFTP with profile galleries and cross-page side-by-side and split comparisons.
- Experimental stateless MCP over Streamable HTTP with scoped tools to list projects, inspect project and capture metadata, and trigger capture runs with optional idempotency.

### Changed

- Manual capture controls use browser-compatible idempotency keys on HTTPS and plain-HTTP LAN origins, acknowledge clicks immediately, show queued and per-profile progress, and remain unavailable until the active batch finishes.
- Project work is split into focused Compare and Configuration workspaces with profile-first, 12-frame history pages and automatic Earlier/Later comparisons.
- Administrator and built-in public comparisons expose explicit side-by-side, split, overlay, and heatmap views with keyboard-operable controls.
- Capture queries filter status before pagination and expose exact successful/failed totals.
- Webhooks can be paused, edited, tested, rotated, inspected, and deleted from Configuration.
- Comparisons now enforce successful same-profile inputs, bounded resources, rate limits, and short-lived caching.
- Static publication targets now use clear unpublished-state copy, persistent connection-verification results, and live queued, building, and deploying progress with elapsed time.
- Schedule policy saves now show pending and saved feedback in place, make the persisted enabled state unmistakable, and display the next capture time.
- Administrator capture history now exposes recent terminal failures with safe stage-specific reasons such as selector, navigation, and connection failures.
- Release operators can run a guarded backup/restore rehearsal that records readiness, SQLite integrity, retained-image digest, and a fresh three-browser batch without deleting the source volume.

### Database

- Creates the initial forward-only schema plus static-publication tables and the capture-history status index. Downgrades are unsupported.
