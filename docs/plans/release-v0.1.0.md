# v0.1.0 release and launch checklist

This checklist is the durable runbook for the first Screenshot-a-Day release. Check an item only after verifying the public result; do not rewrite a released tag.

## Release preparation

- [ ] Merge PR #9 after `validate`, `container-smoke`, DCO, and CodeQL pass and every conversation is resolved.
- [ ] Confirm `main` is green and the Pages preview deploys only `site/` under `/screenshot-a-day/`.
- [ ] Confirm `VERSION`, package manifests, contracts, Compose image pins, changelog, OCI labels, and `/version` report `0.1.0`.
- [ ] Confirm GitHub Pages uses GitHub Actions and `main` protection requires pull requests, linear history, `validate`, `container-smoke`, and DCO.
- [ ] Confirm secret scanning, push protection, Dependabot alerts/security updates, CodeQL default setup, web-commit sign-off, and private vulnerability reporting are enabled.
- [ ] Confirm every PR #9 commit contains a matching `Signed-off-by` trailer and the DCO App reports success.
- [ ] Exercise administrator Compare and Configuration, built-in indexable and unlisted galleries, static cross-page restoration, lifecycle confirmations, and desktop/mobile layouts without console errors.
- [ ] Complete the clean-volume backup/restore rehearsal with the original encryption key, SQLite integrity `ok`, retained image reads, and a new capture.

### Current pre-merge evidence

Refresh this section after the final push if any code changes.

- `pnpm check`: 18 files and 75 tests passed, including migration 3, comparison limits/capacity/cache/rate limiting, pagination, webhook lifecycle, OpenAPI structure, and static rendering.
- `pnpm build` and `pnpm test:e2e` passed; the browser smoke covers administrator Compare/Configuration, API-token creation, public and unlisted galleries, mobile layout, and static cross-page selection restoration.
- `pnpm audit --prod` reported no known vulnerabilities.
- Both locally built Compose containers were recreated on port 4400 and reported healthy/ready with the release security headers.
- An isolated port-4410 restore recovered 132 captures, passed SQLite integrity, served an authenticated retained PNG, and completed a fresh Chromium capture. The rehearsal also verified that restored `/data` ownership must be normalized before startup.

## Publish v0.1.0

- [ ] At the current green `main` tip, create `git tag -s v0.1.0 -m "Screenshot-a-Day v0.1.0"` or an unsigned annotated tag with `git tag -a`.
- [ ] Push only `v0.1.0`; verify lightweight, mismatched, prerelease-alias, and stale-main tags fail safely.
- [ ] Wait for both multi-architecture GHCR images, SBOMs, provenance attestations, immutable digests, and the GitHub Release.
- [ ] Confirm the `0.1.0`, `0.1`, and `latest` tags resolve to the same stable manifests and that no floating `0` tag exists.
- [ ] On a clean machine, pull rather than build and run Compose; test setup, all three browsers, comparison, retention, sharing, GIF, WebM, webhook delivery, and backup/restore.

## Demo and Pages cutover

- [ ] Deploy the exact released image digests at `https://screenshots.arts-link.com/`.
- [ ] Validate TLS, backups and restore, setup, workers, retention, robots behavior, isolated administration, and public galleries for `arts-link.com`, `benstrawbridge.com`, and `example.com`.
- [ ] Redirect the demo root to the primary gallery; keep administration on the explicit login route and use only public content.
- [ ] Merge the prepared site-only launch pull request after the demo is healthy: change the badge to “Open source · v0.1.0,” link the version to the release, and add “View live demo” in the header/hero and closing CTA.
- [ ] Confirm Pages has working GitHub, installation, release, security, Arts-Link, and demo links, including with JavaScript disabled and on mobile.
- [ ] Set the repository homepage to `https://arts-link.github.io/screenshot-a-day/` and use `site/og.png` as the repository social preview.

## Distribution

- [ ] T0: publish the GitHub Release, GHCR images, Pages launch state, live demo, and Arts-Link announcement.
- [ ] T0–T7: submit the Pages URL to selfh.st, AlternativeTo, and OpenAlternative; use GitHub as source and the live demo as demo.
- [ ] T+14: post “Show HN: Screenshot-a-Day – self-hosted visual history for websites” with immediate demo and install paths.
- [ ] T+17–21: post separately to r/selfhosted and incorporate early feedback.
- [ ] T+21–30: self-launch from a personal Product Hunt account without tracking parameters.
- [ ] T+4 months and one day: submit to awesome-selfhosted-data under archiving/digital preservation (December 18, 2026 or later for an August 17 release).

Required launch assets: three real product screenshots, a 45–60 second walkthrough, a square Product Hunt thumbnail, at least four Product Hunt gallery images, and channel-specific announcement copy.

## Future releases

1. Add a Changeset to each user-visible pull request.
2. Run “Version packages” and review the generated version pull request.
3. Merge after required checks, then tag the exact green version commit.
4. Let the tag workflow publish containers, SBOMs, attestations, digests, and release notes.
5. Update `site/` only for launch-facing copy or links. Correct defects with patch releases; never rewrite released tags.
