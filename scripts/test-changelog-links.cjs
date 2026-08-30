#!/usr/bin/env node
// Checks every documentation link in docs/changelog.md — that the file it
// names exists, and that the `#anchor` lands on a real heading in it.
//
// The changelog points a reader at the guide for each change, which is only
// useful if the pointer is right. A link to a section that has been renamed
// resolves to the top of the page and quietly wastes the reader's time; a
// link to a file that has been split or removed 404s at /docs. Neither shows
// up in a diff, and neither is something a human reviewer checks by hand.
//
// The anchors have to match `addHeadingIds` in lib/docs.ts, which reproduces
// GitHub's slug rules so a link written for GitHub lands on the same section
// when the guides are served from the app. That function only gives ids to
// h2-h4, so a link to an h1 has nothing to land on and is rejected here.

const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };

/** GitHub's heading slug — the same transformation lib/docs.ts applies. */
const slugify = text =>
  text
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // a linked heading slugs its text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');

/** Every anchor a guide offers, numbered for duplicates as GitHub numbers them. */
function anchorsOf(file) {
  const seen = new Map();
  const anchors = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^(#{2,4})\s+(.*)$/.exec(line);
    if (!m) continue;
    const base = slugify(m[2]);
    if (!base) continue;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

const changelog = fs.readFileSync(path.join(DOCS, 'changelog.md'), 'utf8');
const docsLines = changelog.split('\n').filter(l => l.trim().startsWith('Docs:'));

console.log('── the changelog points at its documentation ──');
if (docsLines.length > 0) ok(`${docsLines.length} entries carry a Docs line`);
else no('entries carry a Docs line', 'found none — has the convention been dropped?');

// Every entry that names a pull request is a shipped change. It may legitimately
// have no guide (a test suite, a refactor, a CI gate), so this counts rather
// than requires — a sharp drop in coverage is the signal worth seeing.
const entries = changelog.split('\n').filter(l => /^- \*\*/.test(l)).length;
ok(`${docsLines.length} of ${entries} entries link to a guide`);

console.log('\n── every link resolves ──');
const anchorCache = new Map();
let checked = 0;

for (const line of docsLines) {
  for (const [, label, target] of line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    checked++;
    const [file, anchor] = target.split('#');

    if (/^https?:/.test(target)) { no(label, 'must be a relative link into docs/'); continue; }
    if (!file.endsWith('.md')) { no(label, `not a guide: ${target}`); continue; }
    if (file.includes('/')) { no(label, `must sit in docs/, got ${file}`); continue; }

    const full = path.join(DOCS, file);
    if (!fs.existsSync(full)) { no(label, `no such guide: ${file}`); continue; }

    if (!anchor) { ok(`${label} → ${file}`); continue; }

    if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(full));
    if (anchorCache.get(file).has(anchor)) ok(`${label} → ${file}#${anchor}`);
    else no(label, `${file} has no section "#${anchor}"`);
  }
}

if (checked > 0) ok(`${checked} links checked`);
else no('links checked', 'none found');

console.log(failures === 0 ? '\nAll changelog link tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
