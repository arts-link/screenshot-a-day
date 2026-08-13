# Changelog

All notable changes to Screenshot-a-Day are documented here. The project follows Semantic Versioning.

## 0.1.0 - Unreleased

### Added

- Initial self-hosted API, browser worker, administrator UI, and public galleries.
- Cross-browser capture profiles, schedules, retained history, comparisons, GIF/WebM exports, and signed webhooks.
- Docker Compose deployment, documented security controls, OpenAPI documentation, and coordinated semantic releases.

### Changed

- Manual capture controls now acknowledge clicks immediately, show queued and per-profile progress, and remain unavailable until the active batch finishes.

### Database

- Creates the initial forward-only v1 schema. Downgrades are unsupported.
