# ADR 0005: Use one administrator and encrypted target secrets

Status: accepted

One administrator is established with a short-lived setup token and authenticates through a server session. Target headers and cookies are encrypted with an installation-owned AES-256-GCM key and are only revealed to an authenticated worker for the active job. API tokens are hashed and scoped.
