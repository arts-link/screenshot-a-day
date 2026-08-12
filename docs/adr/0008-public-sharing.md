# ADR 0008: Support three publication modes

Status: accepted

Projects are private by default. Unlisted galleries use a rotatable random token and `noindex`; indexable galleries use a readable unique slug. Public routes are read-only and never serialize target headers, cookies, worker credentials, or administration data.
