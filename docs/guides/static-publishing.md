# Static gallery publishing

Static targets build a complete Hugo site on the Screenshot-a-Day host and deploy identical output to an existing Vercel project, Netlify site, or dedicated SFTP directory. The home server needs outbound HTTPS and, for SFTP, outbound SSH only. It never needs an inbound public route.

Create the destination site with its hosting provider first, then open **Settings → Static publication targets**. Supply its canonical URL and scoped credential. Verify the connection before attaching projects. Credentials are write-only after save.

Each target contains every attached project:

- indexable projects use `/p/{slug}/` and appear on the root page, sitemap, and RSS feed;
- unlisted projects use `/s/{share-token}/`, carry `noindex`, and do not appear on the root page;
- private projects are omitted from the build.

The built-in gallery remains available until the first successful static deployment. After that handoff, its public routes return 404 and the admin links to the static URL. To detach, first switch the project to private. Screenshot-a-Day immediately queues a removal deployment and detaches only after it succeeds.

Vercel and Netlify deployments use their atomic full-site APIs. SFTP uploads immutable assets first, atomically replaces pages, writes the root index last, and deletes only stale paths from Screenshot-a-Day's prior manifest. The root must be empty or have the matching `.screenshot-a-day-target.json` marker.

Ryder v0.4.1 is bundled behind the `hugo-ryder` renderer interface. Every generated page permanently links to the Ryder theme, Arts-Link, and Screenshot-a-Day source. Branding can add supplemental footer text but cannot remove those links. Analytics is disabled by default.

Unlisted means URL secrecy, not authentication. A remote deletion cannot recall files a visitor already downloaded.
