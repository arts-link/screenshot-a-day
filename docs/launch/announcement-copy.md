# v0.1.0 launch copy

Use the clean Pages URL without tracking parameters. Publish only after the GitHub Release, GHCR images, Pages launch state, and live demo are healthy. Replace bracketed operational facts only with verified values.

## Shared links

- Project: https://arts-link.github.io/screenshot-a-day/
- Demo: https://screenshots.arts-link.com/
- Source and releases: https://github.com/arts-link/screenshot-a-day
- Install: https://github.com/arts-link/screenshot-a-day#quick-start

## Arts-Link — T0

Screenshot-a-Day v0.1.0 is out: a self-hosted visual history for websites you are responsible for.

Schedule reproducible Chromium, Firefox, and WebKit captures; compare changes; keep private archives or publish galleries; and generate GIF/WebM timelines. It runs from two multi-architecture containers on your infrastructure, includes no product telemetry, and is AGPL-3.0-or-later.

Try the public demo, read the quick start, or inspect the source:
https://arts-link.github.io/screenshot-a-day/

## Directory short description — T0 to T+7

Self-hosted visual history for websites with scheduled cross-browser captures, comparisons, galleries, and GIF/WebM timelines.

Suggested fields:

- License: AGPL-3.0-or-later
- Source: https://github.com/arts-link/screenshot-a-day
- Demo: https://screenshots.arts-link.com/
- Platforms: Docker-compatible linux/amd64 and linux/arm64
- Telemetry: none

## Hacker News — T+14

Title:

> Show HN: Screenshot-a-Day – self-hosted visual history for websites

Body:

> I built Screenshot-a-Day because checking whether a website is “still there” is not the same as being able to see how it changed.
>
> It schedules reproducible Chromium, Firefox, and WebKit captures, compares any two moments, and publishes optional galleries plus GIF/WebM timelines. The API and browser worker run as two Docker images with a local SQLite archive. Headers and cookies are encrypted, private-network targets require an allowlist, and there is no product telemetry.
>
> Demo: https://screenshots.arts-link.com/
> Install/source: https://github.com/arts-link/screenshot-a-day
>
> v0.1.0 is intentionally small: one API replica, forward-only migrations, and operator-managed TLS/backups/storage. I would especially value feedback on the deployment path, capture reproducibility, and which comparison views are actually useful.

## r/selfhosted — T+17 to T+21

Title:

> Screenshot-a-Day v0.1.0: scheduled visual history on your own infrastructure

Body:

> I have released Screenshot-a-Day, an AGPL self-hosted service for keeping a visual history of websites you manage. It captures with Chromium, Firefox, and WebKit, compares changes, supports private/unlisted/public sharing, and exports GIF/WebM timelines.
>
> The Compose deployment uses two pinned GHCR images and one persistent volume. It sends no product telemetry. v0.1.0 uses SQLite, supports one API replica, and leaves TLS, backups, monitoring, and retention to the operator.
>
> Project and install: https://arts-link.github.io/screenshot-a-day/
> Public demo: https://screenshots.arts-link.com/
>
> [Add the two or three most relevant lessons or fixes from early launch feedback here.] I would appreciate practical self-hosting feedback, especially from ARM hosts and reverse-proxy setups.

## Product Hunt — T+21 to T+30

Tagline:

> Self-hosted visual history for websites

Description:

> Schedule cross-browser screenshots, compare what changed, and publish visual timelines while keeping the archive on infrastructure you control. Open source, Docker-first, and no product telemetry.

Maker comment:

> I made Screenshot-a-Day for teams and individuals who need more than uptime: a visual record of what a website actually looked like over time. v0.1.0 focuses on a legible self-hosted core—scheduled Chromium, Firefox, and WebKit captures; comparisons; sharing; and GIF/WebM timelines. I would love feedback on installation, retention controls, and the gallery experience.

## Claims guardrail

Use “signed webhooks” only when describing outbound webhook authentication. Do not call captures or archives signed, certified, immutable, evidentiary, or tamper-proof.
