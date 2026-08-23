# 10. Static publication rendering

Accepted 2026-08-23.

## Context

Operators who run Screenshot-a-Day at home want published galleries on the public internet without exposing the capture host to inbound traffic. Publication therefore renders a complete static site locally and pushes it to hosting the operator already controls (Vercel, Netlify, or an SFTP root).

The first implementation of the renderer generated a Hugo source tree — JSON data files, JSON front matter, and a `hugo.json` — then invoked a pinned Hugo Extended binary with the pinned Ryder theme and read the output back.

Reviewing that before the first tagged release showed the dependency was not earning its cost:

- All nine layouts were project-level, which override theme layouts in Hugo. The only partial was the project's own analytics snippet, and the stylesheet and script were the project's own. The theme contributed a `theme.toml` for the version check and a footer credit link.
- The templates used only `range`, `if`, `with`, `where`, `index`, `time.Format`, and `printf`. No shortcodes, asset pipeline, taxonomies, or internationalisation.
- The configuration disabled taxonomies, aliases, and path lowercasing, and the renderer then post-processed the output to delete alias pages Hugo generated anyway.
- All gallery, profile, and pagination data was already assembled in TypeScript. Hugo was interpolating strings and nothing more.

The cost of that interpolation was a Hugo binary copied across libc boundaries into the API image, a third-party theme pinned at a commit, checksummed install steps in CI, an availability probe with its own user-visible failure mode, and a subprocess that inherited the API's entire environment — including `SAD_ENCRYPTION_KEY`.

## Decision

Keep static publication and its deployment adapters. Render pages in-process from typed TypeScript template functions in `apps/api/src/publication-templates.ts`, behind the existing `PublicationRenderer` interface.

The renderer emits the page set, `sitemap.xml`, `index.xml`, `robots.txt`, content-hashed CSS and JavaScript, content-addressed media, and the `_headers` file directly into a temporary directory. `RenderedPublication` and `ManagedFile` are unchanged, so the Vercel, Netlify, and SFTP adapters are unaffected.

Hugo auto-escaped in HTML context; these templates do not. Every interpolation goes through a single `h()` helper covering element and double-quoted attribute contexts, and dates are formatted from UTC parts rather than through `toLocaleString`, so output stays byte-identical regardless of the host's ICU data.

## Consequences

- The API image carries no site generator, and the cross-libc binary graft is gone.
- Publication no longer spawns a subprocess, so there is no process environment to leak.
- CI needs no Hugo install or theme checkout, and the renderer test runs anywhere.
- Rendering is deterministic without `SOURCE_DATE_EPOCH`.
- Template changes are TypeScript changes, type-checked with the rest of the API.
- Escaping is now the project's responsibility. An unescaped interpolation is a cross-site scripting bug; the renderer test asserts escaping in both element and attribute contexts.
- Richer theming — user-supplied templates, a theme ecosystem — would have to be rebuilt rather than inherited. No operator has asked for it, and the branding fields cover the customisation the product currently offers.

## Alternatives considered

**Keep Hugo and Ryder.** Rejected: the dependency bought template features the project does not use, and carried a binary, a theme pin, CI steps, and a subprocess environment leak.

**Adopt a JavaScript template engine (Eta, Handlebars, Nunjucks).** Rejected: it trades one dependency for another and reintroduces an escaping model to learn, for roughly 200 lines of templates whose data is already assembled in TypeScript.
