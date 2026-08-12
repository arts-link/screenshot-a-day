# ADR 0004: Model captures as Playwright profiles

Status: accepted

A project owns multiple named profiles. Each chooses bundled Chromium, Firefox, or WebKit plus viewport/device and rendering preferences. A run batches every enabled profile so cross-browser history shares a schedule while failures remain independent.
