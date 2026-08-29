# Changelog

All notable changes to Screenshot-a-Day are documented here. The project follows Semantic Versioning.

## 0.1.0 - Unreleased

### Added

- Initial self-hosted API, browser worker, administrator UI, and public galleries.
- Cross-browser capture profiles, schedules, retained history, comparisons, GIF/WebM exports, and signed webhooks.
- Docker Compose deployment, documented security controls, OpenAPI documentation, and coordinated semantic releases.
- Portable static publication to Vercel, Netlify, and SFTP with profile galleries and cross-page browser-only comparisons.

### Changed

- Manual capture controls now acknowledge clicks immediately, show queued and per-profile progress, and remain unavailable until the active batch finishes.
- Project work is split into focused Compare and Configuration workspaces with profile-first, 12-frame history pages and automatic Earlier/Later comparisons.
- Capture queries filter status before pagination and expose exact successful/failed totals.
- Webhooks can be paused, edited, tested, rotated, inspected, and deleted from Configuration.
- Comparisons now enforce successful same-profile inputs, bounded resources, rate limits, and short-lived caching.
- Static publication targets now use clear unpublished-state copy, persistent connection-verification results, and live queued, building, and deploying progress with elapsed time.

### Database

- Creates the initial forward-only schema plus static-publication tables and the capture-history status index. Downgrades are unsupported.
