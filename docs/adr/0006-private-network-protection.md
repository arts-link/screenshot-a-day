# ADR 0006: Block private networks by default

Status: accepted

Arbitrary capture URLs create an SSRF boundary even in a self-hosted service. Loopback, link-local, private, and metadata destinations are denied after DNS resolution and on redirects. Operators may explicitly allow hostnames or CIDRs for intentional internal monitoring.
