import type { PublicationBranding } from "@sad/contracts";

export interface CaptureFrame {
  id: string;
  capturedAt: string;
  changePercent: number | null;
  image: string | null;
  thumbnail: string | null;
  diff: string | null;
}

export interface ProfilePage {
  id: string;
  name: string;
  browser: string;
  page: number;
  pages: number;
  captures: CaptureFrame[];
  previous: string | null;
  next: string | null;
}

export interface ProfileSummary {
  id: string;
  name: string;
  browser: string;
  captureCount: number;
  latestThumbnail: string | null;
  path: string | undefined;
  gif: string | null;
  webm: string | null;
}

export interface Gallery {
  id: string;
  name: string;
  mode: "private" | "unlisted" | "indexable";
  indexable: boolean;
  path: string;
  captureCount: number;
  profileCount: number;
  latestThumbnail: string | null;
  updatedAt: string;
  profiles: ProfileSummary[];
  pages: Array<{ path: string; page: ProfilePage }>;
}

export interface SiteContext {
  baseUrl: string;
  branding: PublicationBranding;
  cssPath: string;
  jsPath: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Dates are formatted from UTC parts rather than through `toLocaleString` so that
 * output stays byte-identical across hosts regardless of the runtime's ICU data.
 */
function parts(value: string): {
  date: Date;
  year: number;
  month: number;
  day: number;
  hour: string;
  minute: string;
  second: string;
} {
  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, "0");
  return {
    date,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
    hour: pad(date.getUTCHours()),
    minute: pad(date.getUTCMinutes()),
    second: pad(date.getUTCSeconds()),
  };
}

export function formatShortDate(value: string): string {
  const { year, month, day } = parts(value);
  return `${MONTHS[month]!.slice(0, 3)} ${day}, ${year}`;
}

export function formatShortDateTime(value: string): string {
  const { year, month, day, hour, minute } = parts(value);
  return `${MONTHS[month]!.slice(0, 3)} ${day}, ${year} ${hour}:${minute} UTC`;
}

export function formatLongDateTime(value: string): string {
  const { year, month, day, hour, minute } = parts(value);
  return `${MONTHS[month]} ${day}, ${year} ${hour}:${minute} UTC`;
}

export function formatRssDate(value: string): string {
  const { date, year, month, day, hour, minute, second } = parts(value);
  const dayName = DAYS[date.getUTCDay()]!;
  return `${dayName}, ${String(day).padStart(2, "0")} ${MONTHS[month]!.slice(0, 3)} ${year} ${hour}:${minute}:${second} +0000`;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapes for both element and double-quoted attribute contexts. Every interpolation
 * in this file goes through `h` or `x`; Hugo escaped automatically, these templates
 * do not, so an unescaped hole here is a cross-site scripting bug.
 */
export function h(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!);
}

export function x(value: unknown): string {
  return h(value);
}

function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function analyticsOrigin(host: string): string {
  const url = new URL(host);
  return `${url.protocol}//${url.host}`;
}

export function contentSecurityPolicy(branding: PublicationBranding): string {
  const extra =
    branding.analytics.provider === "plausible"
      ? "https://plausible.io"
      : branding.analytics.provider === "posthog"
        ? analyticsOrigin(branding.analytics.host)
        : null;
  const script = extra ? `'self' ${extra}` : "'self'";
  const connect = extra ? `'self' ${extra}` : "'self'";
  // `frame-ancestors` is deliberately absent: the CSP specification strips it (along
  // with `report-uri` and `sandbox`) from any policy delivered in a meta element.
  // Clickjacking protection has to come from a real response header.
  return [
    "default-src 'none'",
    "img-src 'self' data:",
    "media-src 'self'",
    "style-src 'self'",
    `script-src ${script}`,
    "font-src 'self'",
    `connect-src ${connect}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function analyticsTag(branding: PublicationBranding): string {
  const analytics = branding.analytics;
  if (analytics.provider === "plausible") {
    return `<script defer data-domain="${h(analytics.domain)}" src="https://plausible.io/js/script.js"></script>`;
  }
  if (analytics.provider === "posthog") {
    return `<script defer src="${h(`${analytics.host.replace(/\/$/, "")}/static/array.js`)}" data-api-key="${h(analytics.apiKey)}"></script>`;
  }
  return "";
}

interface PageOptions {
  site: SiteContext;
  title: string | null;
  description: string;
  noindex: boolean;
  main: string;
}

export function layout({ site, title, description, noindex, main }: PageOptions): string {
  const { branding } = site;
  return `<!doctype html>
<html lang="en"${noindex ? ' data-unlisted="true"' : ""}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#12100e" />
    <title>${title ? `${h(title)} · ` : ""}${h(branding.title)}</title>
    <meta name="description" content="${h(description || branding.description)}" />
    ${noindex ? '<meta name="robots" content="noindex,nofollow,noarchive" />' : ""}
    <meta http-equiv="Content-Security-Policy" content="${h(contentSecurityPolicy(branding))}" />
    <link rel="stylesheet" href="/${h(site.cssPath)}" />
    <script defer src="/${h(site.jsPath)}"></script>
    ${analyticsTag(branding)}
  </head>
  <body class="${branding.darkMode ? "dark" : ""}">
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <a class="product-mark" href="/" aria-label="Screenshot-a-Day gallery home">
        Screenshot-a-Day
      </a>
      <span class="header-divider" aria-hidden="true"></span>
      <div class="maker-lockup">
        <a href="https://www.arts-link.com/">arts-link</a>
      </div>
      <nav aria-label="Primary navigation">
        <a href="/">Galleries</a>
        <a href="https://arts-link.github.io/screenshot-a-day/">About</a>
        <a class="nav-source" href="https://github.com/arts-link/screenshot-a-day">
          Source <span aria-hidden="true">↗</span>
        </a>
      </nav>
    </header>
    <main id="main">${main}</main>
    <footer class="site-footer">
      <div>
        <a class="footer-maker" href="https://www.arts-link.com/">arts-link</a>
        <p>${branding.supplementalFooter ? h(branding.supplementalFooter) : "Published from a home server. Static files only."}</p>
      </div>
      <div class="footer-meta">
        <p><a href="https://github.com/arts-link/screenshot-a-day">Screenshot-a-Day source ↗</a></p>
      </div>
    </footer>
    <dialog id="lightbox">
      <button data-close aria-label="Close">×</button><img alt="Full screenshot" />
      <p></p>
    </dialog>
    <div class="grain" aria-hidden="true"></div>
  </body>
</html>
`;
}

export function homePage(site: SiteContext, galleries: Gallery[]): string {
  const indexable = galleries.filter((gallery) => gallery.indexable);
  const cards = indexable.length
    ? indexable
        .map(
          (gallery, index) => `      <article class="project-card">
        ${
          gallery.latestThumbnail
            ? `<a class="card-media" href="${h(gallery.path)}"><img loading="lazy" src="/${h(gallery.latestThumbnail)}" alt="Latest capture of ${h(gallery.name)}"></a>`
            : ""
        }
        <div class="card-body">
          <div class="card-meta"><span>${ordinal(index)} · Gallery</span><time>${h(formatShortDate(gallery.updatedAt))}</time></div>
          <h2><a href="${h(gallery.path)}">${h(gallery.name)}</a></h2>
          <p>${gallery.captureCount} retained captures · ${gallery.profileCount} profiles</p>
          <a class="card-link" href="${h(gallery.path)}">Open visual history <span aria-hidden="true">→</span></a>
        </div>
      </article>`,
        )
        .join("\n")
    : '      <p class="empty">No indexable galleries have been published.</p>';

  return layout({
    site,
    title: null,
    description: site.branding.description,
    noindex: false,
    main: `
  <section class="hero hero-home">
    <div class="hero-copy">
      <p class="eyebrow"><span>Visual histories</span> · Published archive</p>
      <h1>${h(site.branding.title)}</h1>
      ${site.branding.tagline ? `<p class="hero-tagline">${h(site.branding.tagline)}</p>` : ""}
      ${site.branding.description ? `<p class="hero-intro">${h(site.branding.description)}</p>` : ""}
    </div>
    <div class="archive-mark" aria-hidden="true">
      <span class="accent-rule"></span>
      <strong>Then → Now</strong>
    </div>
  </section>
  <section class="gallery-section" aria-labelledby="gallery-heading">
    <div class="section-heading">
      <p class="eyebrow" id="gallery-heading">Browse the archive</p>
      <span>Sites recorded over time</span>
    </div>
    <div class="gallery-grid">
${cards}
    </div>
  </section>
`,
  });
}

export function galleryPage(site: SiteContext, gallery: Gallery): string {
  const cards = gallery.profiles
    .map(
      (profile, index) => `  <article class="profile-card">
    ${
      profile.latestThumbnail && profile.path
        ? `<a class="card-media" href="${h(profile.path)}"><img loading="lazy" src="/${h(profile.latestThumbnail)}" alt="Latest ${h(gallery.name)} capture for ${h(profile.name)}" /></a>`
        : ""
    }
    <div class="card-body">
      <div class="card-meta"><span>${ordinal(index)} · Profile</span><span>${h(profile.browser)}</span></div>
      <h2><a href="${h(profile.path ?? gallery.path)}">${h(profile.name)}</a></h2>
      <p>${profile.captureCount} retained frames</p>
      <div class="card-actions">
        <a class="card-link" href="${h(profile.path ?? gallery.path)}">View captures <span aria-hidden="true">→</span></a>
        <div class="animation-links">
          ${profile.gif ? `<a href="/${h(profile.gif)}">GIF</a>` : ""} ${profile.webm ? `<a href="/${h(profile.webm)}">WebM</a>` : ""}
        </div>
      </div>
    </div>
  </article>`,
    )
    .join("\n");

  return layout({
    site,
    title: gallery.name,
    description: `${gallery.name} visual history`,
    noindex: gallery.mode === "unlisted",
    main: `
<section class="hero compact">
  <p class="eyebrow"><span>${h(gallery.mode)}</span> · Visual history</p>
  <h1>${h(gallery.name)}</h1>
  <p class="hero-intro">
    ${gallery.captureCount} retained captures. Updated ${h(formatLongDateTime(gallery.updatedAt))}.
  </p>
</section>
<section class="gallery-section">
  <div class="section-heading"><p class="eyebrow">Capture profiles</p><span>${gallery.profileCount} browser views</span></div>
  <div class="profile-grid">
${cards}
  </div>
</section>
`,
  });
}

export function profilePage(site: SiteContext, gallery: Gallery, profile: ProfilePage): string {
  const cards = profile.captures
    .map(
      (
        capture,
        index,
      ) => `  <article class="capture-card" data-capture-card data-capture-id="${h(capture.id)}">
    <button class="image-button" data-lightbox="/${h(capture.image)}" data-caption="${h(capture.capturedAt)}">
      <img loading="lazy" src="/${h(capture.thumbnail)}" alt="Capture from ${h(capture.capturedAt)}" />
    </button>
    <div class="capture-body">
      <div class="card-meta"><span>${ordinal(index)} · ${h(formatShortDateTime(capture.capturedAt))}</span></div>
      <strong>${capture.changePercent === null ? "Opening frame" : `${h(capture.changePercent.toFixed(3))}% changed`}</strong>
      <div class="capture-actions">
        ${capture.diff ? `<a href="/${h(capture.diff)}">Diff →</a>` : ""}
        <button type="button" class="compare" data-compare-id="${h(capture.id)}" data-compare-image="/${h(capture.image)}" data-compare-date="${h(capture.capturedAt)}">Select to compare</button>
      </div>
    </div>
  </article>`,
    )
    .join("\n");

  return layout({
    site,
    title: `${profile.name} · ${gallery.name}`,
    description: `${gallery.name} visual history for ${profile.name}`,
    noindex: gallery.mode === "unlisted",
    main: `
<nav class="crumb" aria-label="Breadcrumb"><a href="${h(gallery.path)}">← ${h(gallery.name)}</a></nav>
<section class="hero compact">
  <p class="eyebrow"><span>${h(profile.browser)}</span> · Capture profile</p>
  <h1>${h(profile.name)}</h1>
  <p class="hero-intro">Page ${profile.page} of ${profile.pages}</p>
</section>
<section class="browser-compare" data-comparison-workspace data-comparison-scope="${h(`${gallery.id}:${profile.id}`)}">
  <div class="section-heading"><p class="eyebrow">Browser-only split</p><span>Choose Earlier and Later</span></div>
  <div class="comparison-tray" aria-label="Comparison selection">
    <div class="compare-slot active" data-slot="earlier"><div><span>Earlier</span><strong data-slot-value>Choose the earlier frame</strong></div><div class="slot-actions"><button type="button" data-slot-change="earlier" hidden>Change</button><button type="button" data-slot-remove="earlier" hidden>Remove</button></div></div>
    <div class="compare-slot" data-slot="later"><div><span>Later</span><strong data-slot-value>Choose the later frame</strong></div><div class="slot-actions"><button type="button" data-slot-change="later" hidden>Change</button><button type="button" data-slot-remove="later" hidden>Remove</button></div></div>
  </div>
  <p class="comparison-empty" data-comparison-empty>Selections persist while you move between pages in this profile.</p>
  <div class="split-result" data-split-result hidden>
    <img data-before alt="First selected screenshot" /><span
      ><img data-after alt="Second selected screenshot" /></span
    ><input type="range" min="0" max="100" value="50" aria-label="Comparison split" />
  </div>
</section>
<section class="gallery-section">
  <div class="section-heading"><p class="eyebrow">Recorded frames</p><span>12 frames per page</span></div>
  <div class="capture-grid">
${cards}
  </div>
</section>
<nav class="pagination">
  ${profile.previous ? `<a href="${h(profile.previous)}">← Newer</a>` : ""}
  ${profile.next ? `<a href="${h(profile.next)}">Older →</a>` : ""}
</nav>
`,
  });
}

export function notFoundPage(site: SiteContext): string {
  return layout({
    site,
    title: "Gallery not found",
    description: site.branding.description,
    noindex: true,
    main: `
<section class="hero">
  <p class="eyebrow">404</p>
  <h1>Gallery not found</h1>
  <p><a href="/">Return to the gallery index</a></p>
</section>
`,
  });
}

function absolute(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

export function rssFeed(site: SiteContext, galleries: Gallery[]): string {
  const items = galleries
    .filter((gallery) => gallery.indexable)
    .map((gallery) => {
      const link = absolute(site.baseUrl, gallery.path);
      return `<item><title>${x(gallery.name)}</title><link>${x(link)}</link><guid>${x(link)}</guid><pubDate>${x(formatRssDate(gallery.updatedAt))}</pubDate></item>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<rss version="2.0"><channel><title>${x(site.branding.title)}</title><link>${x(`${site.baseUrl}/`)}</link><description>${x(site.branding.description)}</description>
${items}
</channel></rss>
`;
}

export function sitemapXml(site: SiteContext, galleries: Gallery[]): string {
  const indexable = galleries.filter((gallery) => gallery.indexable);
  const urls = [
    { location: `${site.baseUrl}/`, lastModified: null as string | null },
    ...indexable.flatMap((gallery) => [
      { location: absolute(site.baseUrl, gallery.path), lastModified: gallery.updatedAt },
      ...gallery.pages.map((page) => ({
        location: absolute(site.baseUrl, page.path),
        lastModified: gallery.updatedAt,
      })),
    ]),
  ];
  const entries = urls
    .map(
      ({ location, lastModified }) =>
        `  <url><loc>${x(location)}</loc>${lastModified ? `<lastmod>${x(new Date(lastModified).toISOString())}</lastmod>` : ""}</url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

export function robotsTxt(site: SiteContext): string {
  return `User-agent: *
Allow: /
Disallow: /s/

Sitemap: ${site.baseUrl}/sitemap.xml
`;
}
