#!/usr/bin/env node
// Builds the GitHub Pages site into _site/ — a front page, and every guide in
// docs/ rendered to static HTML.
//
// The guides are not copied or rewritten for the site. They are rendered by
// `renderMarkdown()` in lib/docs.ts, the same function the app's /docs route
// uses, with only the link targets swapped; the sidebar comes from `docsNav()`,
// so docs/README.md decides the grouping here exactly as it does in the app.
// The front page's feature list is read out of the root README's "What it
// does" section, and its gallery captions out of the guides' own alt text. A
// second hand-kept copy of either would be the shape this repo keeps being
// bitten by: two lists, one of them stale, and the stale one on screen.
//
// Then it checks every relative link and image in the output — the file it
// names exists, and an `#anchor` lands on a real id — and exits 1 if one does
// not. A guide linking a renamed section is invisible in a diff; here it fails
// the build.
//
//   node scripts/build-site.cjs            # writes _site/
//   node scripts/build-site.cjs --out DIR  # somewhere else

const fs = require('fs');
const path = require('path');
const { compile } = require('./_compile-ts.cjs');

const root = path.join(__dirname, '..');
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(root, outArg > 0 ? process.argv[outArg + 1] : '_site');
const REPO = 'https://github.com/nreed97/EzFD';
const DEMO = 'https://fd.w0ny.xyz';
const CLUB = 'https://brainerdham.org';

const ts = compile(['lib/docs.ts']);
const { docsNav, docsOrder, readDoc, readIndex, renderMarkdown } = ts.load('docs');

// ── Links ───────────────────────────────────────────────────────────────────

// Every guide is a flat file in one directory, docs/<slug>.html, so a relative
// link means the same thing from every page — the same reason the app uses
// absolute /docs paths. A Pages site lives under /EzFD/, which an absolute path
// would have to know about; flat relative links don't care where it is served.
const DOC_LINKS = {
  index: 'index.html',
  page: p => (/^[a-z0-9-]+$/.test(p) ? `${p}.html` : `${REPO}/blob/master/docs/${p}.md`),
  image: f => `images/${f}`,
};

// The root README links into docs/ and occasionally at files that are not on
// the site at all (LICENSE, AGENTS.md); those go to GitHub.
const ROOT_LINKS = {
  index: 'docs/index.html',
  page: p => (/^docs\/[a-z0-9-]+$/.test(p) ? `${p}.html` : `${REPO}/blob/master/${p}.md`),
  image: f => `docs/images/${f}`,
};

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Reading the sources ─────────────────────────────────────────────────────

/** A `## Heading` section of a markdown file, without the heading. */
function section(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex(l => l.trim() === `## ${heading}`);
  if (start < 0) throw new Error(`No "## ${heading}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(l => /^#{1,2}\s/.test(l) || l.trim() === '---');
  return rest.slice(0, end < 0 ? undefined : end).join('\n');
}

/** The README's features: each paragraph opening with a bold sentence. */
function features() {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const out = [];
  for (const block of section(readme, 'What it does').split(/\n\s*\n/)) {
    const m = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(block.trim());
    if (!m) continue;   // the screenshot table, which the gallery replaces
    out.push({ title: m[1].replace(/\.$/, ''), html: renderMarkdown(m[2], ROOT_LINKS) });
  }
  if (out.length < 5) throw new Error(`Only ${out.length} features found in README.md`);
  return out;
}

/** The index's own one-line description of each guide. */
function guideBlurbs() {
  const blurbs = new Map();
  for (const line of (readIndex() ?? '').split('\n')) {
    const m = /^\|\s*\[[^\]]+\]\(([a-z0-9-]+)\.md\)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (m) blurbs.set(m[1], m[2]);
  }
  return blurbs;
}

/** Each screenshot's fullest alt text, and the guide it first appears in. */
function screenshotText() {
  const shots = new Map();
  for (const doc of docsOrder()) {
    const md = readDoc(doc.slug).markdown;
    for (const m of md.matchAll(/!\[([^\]]+)\]\(images\/([^)]+)\)/g)) {
      const [, alt, file] = m;
      const had = shots.get(file);
      if (!had) shots.set(file, { alt, guide: doc });
      else if (alt.length > had.alt.length) had.alt = alt;
    }
  }
  return shots;
}

// ── Page shell ──────────────────────────────────────────────────────────────

function page({ title, description, body, depth, current }) {
  const up = depth ? '../' : '';
  const nav = [
    ['Features', `${up}index.html#features`, 'features'],
    ['Install', `${up}index.html#install`, 'install'],
    ['Docs', `${up}docs/index.html`, 'docs'],
    ['Demo', DEMO, 'demo'],
    ['GitHub', REPO, 'github'],
  ].map(([label, href, key]) =>
    `<a href="${href}"${key === current ? ' aria-current="page"' : ''}>${label}</a>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="${up}icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${up}style.css">
</head>
<body>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="${up}index.html"><img src="${up}icon.svg" alt="" width="28" height="28"> EzFD</a>
    <nav class="site-nav" aria-label="Site">${nav}</nav>
  </div>
</header>
${body}
<footer class="site-footer">
  <div class="wrap">
    <p>EzFD is free to use under the
      <a href="${REPO}/blob/master/LICENSE">GLWT licence</a>. It was written with
      AI assistance; the <a href="${REPO}#readme">README</a> says what that means
      for you. Written by Nick Reed, W0NY, for his
      <a href="${CLUB}">club's</a> Field Day.</p>
    <p>This site is built from the guides in the repository's
      <a href="${REPO}/tree/master/docs"><code>docs/</code></a> folder, which also
      ship inside every EzFD install at <code>/docs</code>.</p>
  </div>
</footer>
</body>
</html>
`;
}

// ── The front page ──────────────────────────────────────────────────────────

// Recorded by scripts/record-gifs.cjs.
const ANIMATIONS = [
  ['sign-in.gif', 'Signing in'],
  ['logging.gif', 'Logging, and a dupe caught'],
];

const GALLERY = [
  ['logging-screen.png', 'The logging screen'],
  ['overview.png', 'The site display'],
  ['dashboard.png', 'The section map'],
  ['operators.png', 'Who worked what'],
  ['checkout-board.png', 'Band and mode coordination'],
  ['summary-sheet.png', 'The summary sheet'],
];

function frontPage() {
  const shots = screenshotText();
  const blurbs = guideBlurbs();

  const featureCards = features().map(f => `
      <article class="card">
        <h3>${esc(f.title)}</h3>
        ${f.html}
      </article>`).join('');

  const figures = list => list.map(([file, caption]) => {
    const s = shots.get(file);
    if (!s) throw new Error(`No guide uses docs/images/${file}, so there is no alt text for it`);
    return `
      <figure class="shot">
        <a href="docs/images/${file}"><img src="docs/images/${file}" alt="${esc(s.alt)}" loading="lazy"></a>
        <figcaption><strong>${esc(caption)}</strong> &middot;
          <a href="docs/${s.guide.slug}.html">${esc(s.guide.title)}</a></figcaption>
      </figure>`;
  }).join('');
  const hero = shots.get('live-update.gif');
  if (!hero) throw new Error('No guide uses docs/images/live-update.gif');

  const guides = docsNav().map(g => `
      <div class="guide-group">
        <h3>${esc(g.title)}</h3>
        <ul>${g.docs.map(d => `
          <li><a href="docs/${d.slug}.html">${esc(d.title)}</a>
            <span>${renderMarkdown(blurbs.get(d.slug) ?? '', DOC_LINKS).replace(/^<p>|<\/p>\s*$/g, '')}</span></li>`).join('')}
        </ul>
      </div>`).join('');

  const body = `
<main>
  <section class="hero">
    <div class="wrap">
      <h1>One shared log for Field Day</h1>
      <p class="lede">EzFD is a self-hosted, real-time, multi-operator logger for
        ARRL Field Day, Winter Field Day and special event stations. Every
        operator logs from a browser into one shared log, and every contact
        shows up on every other screen within a second.</p>
      <p class="actions">
        <a class="button primary" href="docs/getting-started.html">Get started</a>
        <a class="button" href="${DEMO}">Try the demo</a>
        <a class="button" href="${REPO}">Source on GitHub</a>
      </p>
      <figure class="hero-shot">
        <img src="docs/images/live-update.gif" alt="${esc(hero.alt)}">
        <figcaption>A contact logged on one screen, left, arriving on the
          dashboard on another, right.</figcaption>
      </figure>
    </div>
  </section>

  <section id="why" class="band">
    <div class="wrap narrow">
      <h2>Why it exists</h2>
      <p>Field Day is a group effort, but most logging programs are built for
        one operator at one computer. Networking several of them together
        usually means installing and configuring the same software on every
        machine, and keeping it working in a tent.</p>
      <p>EzFD takes the other approach. The log lives on one server, and an
        operator joins from any laptop, tablet or phone with a six-character
        join code and a callsign. There are no accounts and nothing to install
        to operate. Dupe checking, band coordination and the score are worked
        out on the server, so every position sees the same answer.</p>
      <p>Field Day sites rarely have good internet, so the server can be a
        Raspberry Pi or an old laptop at the site, running on the local WiFi
        with no internet at all. If the network drops anyway, contacts are kept
        in the browser and sent when it comes back.</p>
      <p>The scoring follows the published rules. The values are transcribed in
        the <a href="docs/rules-reference.html">rules reference</a> with the
        rule number on each line, so you can check a number against the source
        rather than take it on trust.</p>
    </div>
  </section>

  <section id="features">
    <div class="wrap">
      <h2>What it does</h2>
      <div class="cards">${featureCards}
      </div>
    </div>
  </section>

  <section id="screenshots" class="band">
    <div class="wrap">
      <h2>See it in use</h2>
      <p>Recorded on a test server with a Field Day weekend's worth of
        contacts already in the log. Select a picture for the full size.</p>
      <div class="gallery">${figures(ANIMATIONS)}${figures(GALLERY)}
      </div>
    </div>
  </section>

  <section id="install">
    <div class="wrap">
      <h2>Install</h2>
      <p>There are two ways to run your own server. Both run the same app on
        PostgreSQL, and both need the internet while they install. After that,
        the server runs anywhere, including at a site with no internet.</p>
      <div class="install">
        <article class="card">
          <h3>On Debian, Ubuntu or Raspberry Pi OS</h3>
          <p><code>deploy.sh</code> installs Node, PostgreSQL, nginx and
            certbot, builds the app and sets it up as a service. Running it
            again is how you update.</p>
<pre><code># git clone ${REPO}.git /opt/ezfd-src
# cd /opt/ezfd-src
# bash deploy.sh</code></pre>
          <p>It asks for a domain name for the TLS certificate. Leave it blank
            for a field server reached over the local network at
            <code>http://ezfd.local/</code>.</p>
          <p><a href="docs/deployment.html">Deployment</a> &middot;
            <a href="docs/field-server.html">Offline field servers</a></p>
        </article>
        <article class="card">
          <h3>Anywhere with Docker</h3>
          <p>Docker Compose runs the app, PostgreSQL and a Caddy proxy as
            containers, on any 64-bit machine with Docker, whatever the
            distribution.</p>
<pre><code>$ git clone ${REPO}.git ezfd
$ cd ezfd
$ cp .env.example .env
$ nano .env
$ docker compose up -d</code></pre>
          <p><code>.env.example</code> explains every setting and gives the
            command to generate each password.</p>
          <p><a href="docs/deployment.html#docker-compose">Deployment &rarr; Docker Compose</a> &middot;
            <a href="docs/configuration.html">Configuration</a></p>
        </article>
      </div>
      <p>Once it is running, open the site, create an event and give the join
        code to your operators. <a href="docs/getting-started.html">Getting
        started</a> walks through the whole weekend, from install to the
        submitted entry. Someone else running the server? The
        <a href="docs/quick-start.html">quick start</a> is all you need.</p>
    </div>
  </section>

  <section id="rig" class="band">
    <div class="wrap narrow">
      <h2>Rig control</h2>
      <p>Rig control is optional. A small Python script, the rig bridge, runs on
        the operator's own computer and connects the browser to the radio
        through Hamlib's <code>rigctld</code>. Band and mode then follow the
        VFO, and on a radio that supports CAT keying, a CW window with F1 to F12
        macros, auto-CQ and ESM opens alongside the logger.</p>
      <ul>
        <li>Download <code>ezfd-rig-bridge.py</code> from the <strong>Rig</strong>
          button in the logger and run it with <code>python3</code>. It finds or
          offers to install Hamlib, and asks for the radio model and port the
          first time.</li>
        <li>The radio never talks to the EzFD server. The bridge listens on
          <code>ws://localhost:4575</code> on the operator's machine, and only
          logged contacts leave it.</li>
        <li><strong>Use Chrome, Edge or Firefox.</strong> Safari blocks a page
          served over <code>https://</code> from reaching
          <code>ws://localhost</code>, so the bridge never connects.</li>
        <li>FlexRadio SmartCAT emulates a Kenwood TS-2000, so pick Hamlib model
          2014 for it.</li>
        <li>Chromium browsers can also read a Kenwood or Elecraft radio directly
          over USB with nothing installed, on an <code>https://</code> server.
          CW keying still needs the bridge.</li>
      </ul>
      <p><a href="docs/rig-control.html">Rig control and CW</a> &middot;
        <a href="docs/digital-modes.html">Digital modes: WSJT-X and JTDX</a></p>
    </div>
  </section>

  <section id="docs">
    <div class="wrap">
      <h2>Documentation</h2>
      <p>The same guides ship inside every EzFD install at <code>/docs</code>,
        so they are there on a field server with no internet.</p>
      <div class="guides">${guides}
      </div>
    </div>
  </section>
</main>`;

  return page({
    title: 'EzFD: a shared, real-time Field Day logger',
    description: 'A self-hosted, real-time, multi-operator logger for ARRL Field Day, Winter Field Day and special event stations.',
    body,
    depth: 0,
  });
}

// ── The guides ──────────────────────────────────────────────────────────────

function sidebar(currentSlug) {
  const link = (href, label, active) =>
    `<a href="${href}"${active ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  const groups = docsNav().map(g => `
      <li><span class="group">${esc(g.title)}</span>
        <ul>${g.docs.map(d => `<li>${link(`${d.slug}.html`, d.title, d.slug === currentSlug)}</li>`).join('')}</ul>
      </li>`).join('');
  const list = `<ul><li>${link('index.html', 'All guides', currentSlug === null)}</li>${groups}</ul>`;
  // Two copies, as in the app's DocsNav: a `details` for a phone, shut on a
  // guide and open on the index, and a plain list for a wide screen. CSS
  // cannot reliably reveal a shut `details` — Chromium hides it with
  // `content-visibility` on an internal slot — so the width picks a copy.
  return `<nav class="doc-nav" aria-label="Documentation">
    <details class="narrow-only"${currentSlug === null ? ' open' : ''}><summary>All guides</summary>${list}</details>
    <div class="wide-only">${list}</div>
  </nav>`;
}

function docPage(slug, title, markdown) {
  const order = docsOrder();
  const at = slug === null ? -1 : order.findIndex(d => d.slug === slug);
  const prev = at > 0 ? order[at - 1] : null;
  const next = slug === null ? order[0] : (at >= 0 && at < order.length - 1 ? order[at + 1] : null);
  const source = `${REPO}/blob/master/docs/${slug ?? 'README'}.md`;

  const pager = (prev || next) ? `
      <nav class="pager" aria-label="More guides">
        ${prev ? `<a href="${prev.slug}.html"><span>Previous</span>${esc(prev.title)}</a>` : '<span></span>'}
        ${next ? `<a class="next" href="${next.slug}.html"><span>Next</span>${esc(next.title)}</a>` : ''}
      </nav>` : '';

  const body = `
<main class="wrap doc-layout">
  ${sidebar(slug)}
  <div class="doc-main">
    <article class="doc-body">${renderMarkdown(markdown, DOC_LINKS)}</article>
    <p class="source"><a href="${source}">View this page on GitHub</a></p>
    ${pager}
  </div>
</main>`;

  return page({
    title: slug === null ? 'Documentation - EzFD' : `${title} - EzFD docs`,
    description: slug === null
      ? 'Every EzFD guide, grouped by who is reading it.'
      : `${title}: EzFD documentation.`,
    body,
    depth: 1,
    current: 'docs',
  });
}

// ── Build ───────────────────────────────────────────────────────────────────

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'docs', 'images'), { recursive: true });

const write = (rel, content) => fs.writeFileSync(path.join(OUT, rel), content);

write('index.html', frontPage());
write('docs/index.html', docPage(null, 'Documentation', readIndex()));
for (const d of docsOrder()) {
  const doc = readDoc(d.slug);
  write(`docs/${d.slug}.html`, docPage(d.slug, doc.title, doc.markdown));
}
for (const f of fs.readdirSync(path.join(root, 'docs', 'images'))) {
  fs.copyFileSync(path.join(root, 'docs', 'images', f), path.join(OUT, 'docs', 'images', f));
}
fs.copyFileSync(path.join(root, 'site', 'style.css'), path.join(OUT, 'style.css'));
fs.copyFileSync(path.join(root, 'public', 'icons', 'icon.svg'), path.join(OUT, 'icon.svg'));
// Pages runs Jekyll over a branch it publishes; this site is uploaded as an
// artifact and never sees Jekyll, but the marker costs nothing if it ever is.
write('.nojekyll', '');

ts.cleanup();

// ── Check every relative link ───────────────────────────────────────────────

const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) pages.push(p);
  }
})(OUT);

const ids = new Map();
const idsOf = file => {
  if (!ids.has(file)) {
    const html = fs.readFileSync(file, 'utf8');
    ids.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])));
  }
  return ids.get(file);
};

const broken = [];
for (const file of pages) {
  const html = fs.readFileSync(file, 'utf8');
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const ref = m[1].replace(/&amp;/g, '&');
    if (/^(?:[a-z]+:|\/\/)/i.test(ref)) continue;   // external
    const [target, hash] = ref.split('#');
    let resolved = target ? path.resolve(path.dirname(file), decodeURIComponent(target)) : file;
    if (target.endsWith('/') || (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory())) {
      resolved = path.join(resolved, 'index.html');
    }
    const where = `${path.relative(OUT, file)} -> ${ref}`;
    if (!fs.existsSync(resolved)) { broken.push(`${where}  (no such file)`); continue; }
    if (hash && resolved.endsWith('.html') && !idsOf(resolved).has(hash)) {
      broken.push(`${where}  (no #${hash} on that page)`);
    }
  }
}

if (broken.length) {
  console.error(`FAIL  ${broken.length} broken link(s) in the built site:`);
  for (const b of broken) console.error(`  ${b}`);
  process.exit(1);
}
console.log(`ok    built ${pages.length} pages into ${path.relative(root, OUT) || OUT}, every relative link resolves`);
