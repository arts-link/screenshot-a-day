# Security model

Screenshot-a-Day is a privileged browser automation service. Deploy it behind HTTPS and treat its data volume and encryption key as sensitive.

- Initial setup uses a 15-minute one-time token printed only to API logs.
- Passwords use Argon2id. Sessions are HTTP-only, SameSite=Lax, and secure when `SAD_PUBLIC_URL` is HTTPS.
- Browser-origin state changes reject mismatched origins. Login, recovery, and comparison endpoints are rate-limited.
- API tokens are SHA-256 hashes at rest, shown once, scoped, and optionally project-limited.
- Target headers, cookies, and webhook signing secrets use AES-256-GCM envelopes.
- Structured logs redact authorization, cookies, passwords, and target secret fields.
- URL credentials are rejected. DNS answers, redirects, and subresources are checked against the private-network policy.
- Webhook redirects are followed manually, capped at five, and have their destination DNS and address policy revalidated before every request.
- Comparisons require two distinct successful captures from one project/profile, reject decoded images above 16 million pixels, run one at a time with a four-item queue, and use a byte-bounded short-lived cache.
- Production responses set content-type, framing, referrer, permissions, opener, and content-security policies. HTTPS deployments also emit HSTS.
- Workers use a dedicated bearer credential and receive secrets only for their active lease.
- Static deployment credentials are write-only AES-256-GCM envelopes used only by the API publication process; browser workers never receive them.
- SFTP resolves the configured host through the private-target policy, connects to a pinned resolved address, and requires the configured SHA-256 host-key fingerprint.
- An SFTP root must be empty or contain a matching Screenshot-a-Day marker. Cleanup considers only paths recorded in the previous successful managed manifest and preserves unknown files.

The worker executes untrusted web content in Playwright's browser sandbox inside its container. Do not mount host directories, the Docker socket, or the API data volume into it. The default worker has no direct database access.

v0.1.0 does not retain Playwright traces or response bodies. A best-effort final screenshot may be stored on the third failed attempt, so target pages themselves must be treated as sensitive data.

Changing a capture profile clears its test-success marker. Replacing target authentication overwrites the complete encrypted header/cookie envelope and never returns either its old or new plaintext through the API.

An unlisted static gallery is protected only by the secrecy of its URL. It is not authenticated. Privacy-sensitive changes are deployed immediately, but already downloaded files cannot be recalled; the UI does not report removal complete until the remote deployment succeeds.
