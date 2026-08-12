# ADR 0001: Split the control plane and capture worker

Status: accepted

The React/Fastify control plane and Playwright capture worker run as separate processes in one TypeScript monorepo. Browser crashes and memory pressure must not make the settings or history UI unavailable. Shared TypeScript contracts keep the operational boundary explicit without introducing a second language.
