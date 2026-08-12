# Security model

Screenshot-a-Day is a privileged browser automation service. Deploy it behind HTTPS and treat its data volume and encryption key as sensitive.

- Initial setup uses a 15-minute one-time token printed only to API logs.
- Passwords use Argon2id. Sessions are HTTP-only, SameSite=Lax, and secure when `SAD_PUBLIC_URL` is HTTPS.
- Browser-origin state changes reject mismatched origins. Login and recovery endpoints are rate-limited.
- API tokens are SHA-256 hashes at rest, shown once, scoped, and optionally project-limited.
- Target headers, cookies, and webhook signing secrets use AES-256-GCM envelopes.
- Structured logs redact authorization, cookies, passwords, and target secret fields.
- URL credentials are rejected. DNS answers, redirects, and subresources are checked against the private-network policy.
- Webhook redirects are followed manually, capped at five, and have their destination DNS and address policy revalidated before every request.
- Workers use a dedicated bearer credential and receive secrets only for their active lease.

The worker executes untrusted web content in Playwright's browser sandbox inside its container. Do not mount host directories, the Docker socket, or the API data volume into it. The default worker has no direct database access.

v0.1.0 does not retain Playwright traces or response bodies. A best-effort final screenshot may be stored on the third failed attempt, so target pages themselves must be treated as sensitive data.

Changing a capture profile clears its test-success marker. Replacing target authentication overwrites the complete encrypted header/cookie envelope and never returns either its old or new plaintext through the API.
