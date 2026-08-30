#!/usr/bin/env node
// Unit tests for the documentation navigation — lib/docs.ts `docsNav()` and
// `docsOrder()`, which build the app's sidebar by reading the grouping out of
// docs/README.md rather than declaring a second one.
//
// Deriving it that way is what keeps the index and the sidebar from drifting,
// but it introduces one failure the old alphabetical list could not have: a
// guide can now fall out of the navigation entirely — a mistyped filename in
// an index row, a section heading turned into prose, a parser that stops
// matching the table format someone reformatted. The guide would still exist,
// still be reachable by URL, and be invisible in the app.
//
// So the invariant asserted hardest here is the boring one: every guide in
// docs/ appears in the nav exactly once.

const { compile } = require('./_compile-ts.cjs');
const fs = require('fs');
const path = require('path');

const ts = compile(['lib/docs.ts']);
const { docsNav, docsOrder, listDocs } = ts.load('docs');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (actual, expected, m) =>
  actual === expected ? ok(m) : no(m, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

const groups = docsNav();
const order = docsOrder();
const all = listDocs();

console.log('── every guide is reachable ──');
{
  // The one that matters. A guide missing here is a guide nobody finds.
  const inNav = order.map(d => d.slug).sort();
  const onDisk = all.map(d => d.slug).sort();
  eq(inNav.join(','), onDisk.join(','), 'the nav lists exactly the guides in docs/');

  const seen = new Set();
  const twice = order.filter(d => seen.has(d.slug) || (seen.add(d.slug), false));
  eq(twice.length, 0, 'and lists none of them twice');

  eq(order.length > 0, true, 'the nav is not empty');
  eq(groups.every(g => g.docs.length > 0), true, 'no group is empty');
  eq(groups.every(g => typeof g.title === 'string' && g.title.length > 0), true,
     'every group is titled');
  eq(order.every(d => d.title && d.title !== d.slug), true,
     "every guide shows its own '# heading' rather than its filename");
}

console.log('\n── the index decides the grouping ──');
{
  const readme = fs.readFileSync(path.join(__dirname, '..', 'docs', 'README.md'), 'utf8');
  const headings = readme.split('\n')
    .filter(l => /^##\s+/.test(l))
    .map(l => l.replace(/^##\s+/, '').trim());

  // Groups appear in the index's order, and are named by its headings.
  const navTitles = groups.map(g => g.title).filter(t => headings.includes(t));
  const expected = headings.filter(h => navTitles.includes(h));
  eq(navTitles.join(' | '), expected.join(' | '), 'groups follow the index, in its order');

  // Prose sections carry no guides and must not become empty menu headings.
  eq(groups.some(g => g.title === 'Conventions used here'), false,
     'a prose section is not a nav group');

  // The changelog is a guide like any other and has to be findable in the app.
  const changelog = order.find(d => d.slug === 'changelog');
  eq(!!changelog, true, 'the changelog is in the nav');
  eq(changelog && changelog.title, 'Changelog', 'under its own title');

  // Within a group, the index's row order is the order — the guides are
  // written to be read in it, and the previous/next links follow it.
  const runEvent = groups.find(g => g.title === 'I want to run an event');
  eq(!!runEvent, true, 'the audience groups survive');
  eq(runEvent && runEvent.docs[0].slug, 'getting-started',
     'and a group starts where the index starts it');
}

console.log('\n── reading order ──');
{
  // docsOrder is the nav flattened; previous/next walk it, so a mismatch would
  // send a reader to a guide that is not the one below in the sidebar.
  const flattened = groups.flatMap(g => g.docs.map(d => d.slug));
  eq(order.map(d => d.slug).join(','), flattened.join(','),
     'reading order is the sidebar, flattened');

  // First has no previous, last has no next — the page relies on the indices.
  eq(order.findIndex(d => d.slug === order[0].slug), 0, 'the first guide is first');
  eq(order.length >= 2, true, 'there is something to page through');
}

console.log(failures === 0 ? '\nAll docs nav tests passed.' : `\n${failures} failure(s).`);
ts.cleanup();
process.exit(failures === 0 ? 0 : 1);
