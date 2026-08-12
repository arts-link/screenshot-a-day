# Versioning and releases

Screenshot-a-Day follows Semantic Versioning and begins at 0.1.0. All workspace packages and container images move together.

- In 0.x, a fix increments patch; a feature or breaking change increments minor.
- From 1.0.0, breaking changes increment major, compatible features minor, and fixes patch.
- Prereleases use `-alpha.N`, `-beta.N`, or `-rc.N` and never receive `latest`.
- Every user-visible pull request includes a Changeset.
- Stable tags are annotated `vX.Y.Z` tags and publish matching GitHub Releases and GHCR images.
- `/api/v1` and webhook schema versions are compatibility contracts. A breaking contract ships in parallel under a new version.

Database migrations are forward-only unless a release explicitly documents and tests a rollback.
