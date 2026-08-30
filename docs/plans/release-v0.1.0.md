# Screenshot-a-Day v0.1.0 technical release runbook

This is the operator runbook for the first official Screenshot-a-Day release. Run it from top to bottom. Record evidence as you go, stop at any failed gate, and never rewrite a tag after an artifact has been published.

## Release record

Complete this block before starting:

| Field                     | Value    |
| ------------------------- | -------- |
| Release owner             |          |
| Release window            |          |
| Version                   | `0.1.0`  |
| Tag                       | `v0.1.0` |
| Release-candidate commit  |          |
| Merged `main` commit      |          |
| Tag object ID             |          |
| Release workflow          |          |
| API digest                |          |
| Worker digest             |          |
| GitHub Release            |          |
| Demo deployment revision  |          |
| Pages deployment revision |          |

Set these shell variables once per terminal. Recheck `SAD_RELEASE_SHA` after merging; do not copy the pull-request SHA into the tag command.

```sh
export SAD_RELEASE_VERSION=0.1.0
export SAD_RELEASE_TAG=v0.1.0
export SAD_RELEASE_REPO=arts-link/screenshot-a-day
```

## 1. Merge gate

PR [#9](https://github.com/arts-link/screenshot-a-day/pull/9) had green DCO, `validate`, `container-smoke`, and CodeQL checks at `6d28e67` on 2026-08-30. Treat that as historical evidence, not permission to skip a fresh check.

- [ ] Record the current PR head in the release record and review every commit added since the last green evidence.
- [ ] Confirm the PR is mergeable and DCO, `validate`, `container-smoke`, `Analyze (actions)`, and `Analyze (javascript-typescript)` are successful.
- [ ] Confirm every review thread is resolved and no release-blocking conversation remains.
- [ ] Confirm every commit contains the contributor's matching `Signed-off-by` trailer.
- [ ] Rebase-merge PR #9 so the linear, signed commit history is preserved.
- [ ] Wait for the resulting `main` CI run to pass before pulling or tagging.

```sh
export SAD_PR_HEAD="$(gh pr view 9 --repo "$SAD_RELEASE_REPO" --json headRefOid --jq .headRefOid)"
gh pr view 9 --repo "$SAD_RELEASE_REPO" \
  --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup,url
gh pr checks 9 --repo "$SAD_RELEASE_REPO" --required
gh pr merge 9 --repo "$SAD_RELEASE_REPO" --rebase
git switch main
git pull --ff-only origin main
export SAD_RELEASE_SHA="$(git rev-parse HEAD)"
test "$SAD_RELEASE_SHA" = "$(git rev-parse origin/main)"
git status --short
```

Stop if the worktree is not clean, `main` differs from `origin/main`, or a required check is not successful.

## 2. Repository and security preflight

- [ ] Confirm `VERSION`, every workspace package, public contracts, Compose image pins/build arguments, changelog, release notes, and `/version` all report `0.1.0`.
- [ ] Confirm `compose.yaml` pulls GHCR images rather than requiring a local build.
- [ ] Confirm the workspace packages remain private implementation units: this release publishes no npm package and no Docker Hub image.
- [ ] Confirm `docs/releases/v0.1.0.md` accurately lists the final MCP, publication, comparison, security, and UI behavior.
- [ ] Confirm the release workflow still requires an annotated tag at the current `origin/main` tip and publishes no floating `0` tag.
- [ ] Confirm branch protection still requires pull requests, strict status checks, linear history, and DCO.
- [ ] Confirm secret scanning, push protection, Dependabot security updates, CodeQL, private vulnerability reporting, and web-editor sign-off are enabled.
- [ ] Confirm the repository homepage can be set to `https://arts-link.github.io/screenshot-a-day/` at cutover.

```sh
pnpm version:check
git grep -n '0\.1\.0' VERSION package.json apps packages compose.yaml \
  CHANGELOG.md docs/releases/v0.1.0.md
pnpm exec vitest run scripts/check-release.test.mjs
gh api "repos/$SAD_RELEASE_REPO/branches/main/protection"
gh api "repos/$SAD_RELEASE_REPO/private-vulnerability-reporting"
```

## 3. Automated release-candidate validation

Use Node.js 24 and pnpm 11. Run the same paths as CI from the clean merged commit.

```sh
pnpm install --frozen-lockfile
pnpm --filter @sad/worker exec playwright install chromium firefox webkit
pnpm check
pnpm build
pnpm test:e2e
pnpm audit --prod --audit-level high
SAD_ENCRYPTION_KEY=MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA= \
SAD_SESSION_SECRET=release-session-secret-111111111111 \
SAD_WORKER_TOKEN=release-worker-token-22222222222222 \
docker compose config --quiet
```

- [ ] Save the command output or CI URLs in the release record.
- [ ] Confirm formatting, lint, strict types, documentation links, site validation, version drift, all tests, and production builds passed.
- [ ] Confirm the production dependency audit reports no high or critical vulnerability.

## 4. Source-container and manual acceptance test

Build locally from the exact release SHA. Use disposable secrets and a new named volume; do not reuse the demo or development database.

```sh
export SAD_BUILD_COMMIT="$SAD_RELEASE_SHA"
export SAD_ENCRYPTION_KEY="$(openssl rand -base64 32)"
export SAD_SESSION_SECRET="$(openssl rand -hex 32)"
export SAD_WORKER_TOKEN="$(openssl rand -hex 32)"
docker compose build --pull
docker compose up -d api
curl --fail --retry 30 --retry-delay 2 http://localhost:4400/health/ready
docker compose up -d worker
docker compose ps
```

Complete every scenario without console errors:

- [ ] Finish one-time administrator setup and verify login, logout, session expiry, and recovery behavior.
- [ ] Create a project with Chromium, Firefox, and WebKit profiles; complete a manual batch and a scheduled batch.
- [ ] Verify queued, running, partial, completed, and failed batch feedback prevents accidental duplicate work.
- [ ] Compare two compatible captures in side-by-side, split, overlay, and heatmap modes.
- [ ] Verify profile-first pagination and comparison selection restoration across pages.
- [ ] Exercise retention settings without removing protected or newly retained artifacts unexpectedly.
- [ ] Publish private, unlisted, and indexable built-in galleries; rotate or remove sharing and recheck access.
- [ ] Publish a portable static gallery, verify its destination URL, pagination, cross-page comparison restoration, headers, and republish status.
- [ ] Generate and decode GIF and WebM timelines in chronological order.
- [ ] Create, pause, test, rotate, resume, and delete a signed webhook; verify a real delivery signature.
- [ ] Create scoped API tokens and exercise the documented REST API.
- [ ] Connect an MCP client with a read-only token, then a `capture:trigger` token; verify project scope is preserved.
- [ ] Exercise Compare and Configuration on desktop and mobile with keyboard navigation and no browser-console errors.
- [ ] Confirm `/version` reports version `0.1.0` and commit `$SAD_RELEASE_SHA`.

## 5. Backup and restore rehearsal

Follow [the backup guide](../guides/backups.md) exactly. The encryption key and `/data` volume are one recovery unit.

- [ ] Stop writes and take a documented backup of the populated release-candidate volume.
- [ ] Restore it into a clean volume with the original `SAD_ENCRYPTION_KEY`.
- [ ] Normalize restored `/data` ownership before startup.
- [ ] Start an isolated API and worker on a different host port.
- [ ] Run `PRAGMA integrity_check` and record `ok`.
- [ ] Authenticate, read an existing retained PNG, and verify its expected digest.
- [ ] Complete a fresh three-browser capture after restoration.
- [ ] Stop and remove only the disposable rehearsal deployment after evidence is saved.

## 6. Create and validate the tag

Fetch immediately before tagging. A signed annotated tag is preferred; an unsigned annotated tag is acceptable if a signing key is unavailable. Lightweight tags are rejected by automation.

```sh
git fetch --no-tags origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
test -z "$(git status --porcelain)"
git tag -s "$SAD_RELEASE_TAG" -m "Screenshot-a-Day $SAD_RELEASE_TAG"
```

If signing is unavailable, replace only the last command with:

```sh
git tag -a "$SAD_RELEASE_TAG" -m "Screenshot-a-Day $SAD_RELEASE_TAG"
```

Validate before pushing:

```sh
node scripts/check-release.mjs \
  "$SAD_RELEASE_TAG" \
  "$(git cat-file -t "refs/tags/$SAD_RELEASE_TAG")" \
  "$(git rev-list -n 1 "refs/tags/$SAD_RELEASE_TAG")" \
  "$(git rev-parse origin/main)"
git show --no-patch --show-signature "$SAD_RELEASE_TAG"
git push origin "refs/tags/$SAD_RELEASE_TAG"
```

Push only this tag. Do not use `git push --tags`.

## 7. Monitor publication

Open the tag-triggered Release workflow and do not begin promotion until every job is successful.

```sh
gh run list --repo "$SAD_RELEASE_REPO" --workflow Release --limit 5
export SAD_RELEASE_RUN_ID="$(gh run list --repo "$SAD_RELEASE_REPO" --workflow Release \
  --branch "$SAD_RELEASE_TAG" --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$SAD_RELEASE_RUN_ID" --repo "$SAD_RELEASE_REPO" --exit-status
gh release view "$SAD_RELEASE_TAG" --repo "$SAD_RELEASE_REPO"
```

- [ ] `verify` reran `pnpm check`, build, and browser E2E against the tag.
- [ ] API and worker manifests include `linux/amd64` and `linux/arm64`.
- [ ] GHCR packages are public and can be pulled without GitHub authentication.
- [ ] `0.1.0`, `0.1`, and `latest` resolve to the same stable manifest for each image.
- [ ] No `0` tag exists.
- [ ] Both immutable digests appear in the GitHub Release body.
- [ ] GitHub and registry SBOM/provenance attestations exist for both digests.
- [ ] The release title, notes, installation commands, limitations, security link, and changelog link render correctly.

```sh
for image in api worker; do
  docker buildx imagetools inspect \
    "ghcr.io/arts-link/screenshot-a-day-${image}:0.1.0"
  gh attestation verify \
    "oci://ghcr.io/arts-link/screenshot-a-day-${image}:0.1.0" \
    --repo "$SAD_RELEASE_REPO"
done
```

## 8. Clean-machine release test

Use a clean machine or disposable VM with no repository build cache and no authenticated GHCR session.

```sh
git clone --branch "$SAD_RELEASE_TAG" --depth 1 \
  https://github.com/arts-link/screenshot-a-day.git
cd screenshot-a-day
cp .env.example .env
# Generate and set the three required secrets, then:
docker compose pull
docker compose up -d
docker compose logs api
```

- [ ] Confirm Compose pulled rather than built both images.
- [ ] Complete setup and a Chromium, Firefox, and WebKit batch.
- [ ] Repeat comparison, retention, built-in sharing, static publishing, GIF, WebM, webhook, API, and MCP smoke tests.
- [ ] Back up and restore the clean-machine data once.
- [ ] Confirm an anonymous user can follow the public release notes and quick start without unpublished knowledge.

## 9. Demo deployment

- [ ] Deploy the API and worker by the exact immutable digests recorded in the GitHub Release.
- [ ] Verify TLS, readiness, restart policy, persistent storage, monitoring, backup automation, and a restore.
- [ ] Confirm the administrator remains on the explicit login route and is not linked from the public root.
- [ ] Publish only approved public content for Arts-Link-owned or explicitly authorized targets.
- [ ] Verify indexable and unlisted robots behavior and remove any private data from captures.
- [ ] Point `https://screenshots.arts-link.com/` at the primary public gallery and verify its asset, gallery, comparison, and animation URLs.

## 10. Pages marketing-site and analytics cutover

The marketing-site change is a separate, focused pull request after the released demo is healthy.

- [ ] Change the badge to `Open source · v0.1.0` and link it to the GitHub Release.
- [ ] Add live-demo actions in the header, hero, and closing CTA while keeping source and installation paths visible.
- [ ] Verify metadata, canonical URL, JSON-LD version, sitemap, social image, alt text, keyboard focus, and page weight.
- [ ] Confirm `site/privacy.html` accurately distinguishes cookieless Pages analytics from the self-hosted product's no-product-telemetry guarantee.
- [ ] Confirm PostHog uses the public Arts-Link project through `https://g.arts-link.com`, only on the Pages production origin.
- [ ] In PostHog, enable cookieless server hash mode and disable IP capture for the project before merging.
- [ ] Confirm the Pages integration creates no cookies or analytics browser storage; disables profiles, autocapture, replay, surveys, flags, exceptions, heatmaps, and performance capture; and honors DNT/GPC.
- [ ] Confirm only `$pageview`, `marketing_cta_clicked`, and `install_command_copied` arrive, with sanitized URLs/referrers and allowlisted campaign fields.
- [ ] Confirm localhost, non-Pages paths, the application, the demo, and default published galleries receive no automatic marketing events.
- [ ] Run `pnpm site:check` and the full `pnpm check`; merge only after the Pages workflow is green.
- [ ] Test the deployed site on desktop and mobile, with and without JavaScript, and click every release, demo, install, source, security, Arts-Link, and privacy link.
- [ ] Set the repository homepage to `https://arts-link.github.io/screenshot-a-day/` and upload `site/og.png` as the repository social preview.
- [ ] Confirm the PostHog launch dashboard shows a production pageview and one test conversion, then exclude the operator's test traffic from launch reporting.

## 11. Go-live decision and evidence

Promotion may start only when all are true:

- [ ] The tag workflow, GitHub Release, and both public GHCR packages are healthy.
- [ ] The clean-machine installation and restore passed.
- [ ] The exact-digest demo is healthy and contains only approved public content.
- [ ] The Pages launch state and all links are live.
- [ ] Pages analytics is verified or explicitly disabled; a partially working tracker is not acceptable.
- [ ] The release record contains the final SHA, tag object, workflow URLs, digests, attestations, demo revision, Pages revision, and acceptance evidence.

Hand off to the [v0.1.0 promotion runbook](../launch/promotion-v0.1.0.md).

## Failure and recovery rules

| Failure point                                          | Action                                                                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before tagging                                         | Fix through a reviewed PR, rerun all affected gates, and update the release SHA.                                                                                  |
| Release `verify` fails before any package is published | Stop. Confirm no Release or image tag exists before the repository owner decides whether to remove the failed tag and retry.                                      |
| Either image or any GitHub Release artifact exists     | Never move or recreate `v0.1.0`; correct forward as `0.1.1`.                                                                                                      |
| Clean-machine test fails                               | Do not promote. File the defect, publish a patch if artifacts already exist, and test from clean state again.                                                     |
| Demo fails                                             | Keep the prelaunch Pages state or remove its demo links; restore the last known-good deployment or take the demo offline.                                         |
| Pages or analytics fails                               | Keep product artifacts available but stop promotion until a site-only correction is deployed and verified.                                                        |
| Security defect                                        | Use private vulnerability reporting, remove vulnerable public demo access if needed, and publish an advisory plus fixed patch; do not silently rewrite artifacts. |

## Future releases

1. Add a Changeset to each user-visible pull request.
2. Run the Version packages workflow and review the generated version pull request.
3. Merge the exact green version commit and repeat the automated, manual, restore, and clean-machine gates appropriate to the change.
4. Tag the current `origin/main` tip and let the Release workflow publish containers, SBOMs, attestations, digests, and release notes.
5. Correct defects with patch releases and retain immutable tags.
