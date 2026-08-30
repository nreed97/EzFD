import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { marked } from 'marked';

/**
 * Server-side reader for the `docs/` guides, so the running app can show the
 * same documentation that ships in the repository.
 *
 * The list is read from the directory rather than hardcoded. A checked-in list
 * would be a second copy of something the filesystem already knows, and this
 * repo has been bitten by that shape more than once — the ARRL section list in
 * two components, the backup query in four places. Adding a guide should mean
 * adding a file, nothing else.
 */

const DOCS_DIR = join(process.cwd(), 'docs');

/** Slugs are file basenames, so anything with a path separator or a dot is
 *  already not a slug. Checked before the name reaches the filesystem: the
 *  slug arrives from the URL, and `docs/../../etc/passwd` must not resolve. */
const SLUG_RE = /^[a-z0-9-]+$/;

export interface DocMeta {
  slug: string;
  title: string;
}

function titleOf(markdown: string, fallback: string): string {
  const heading = markdown.split('\n').find(l => l.startsWith('# '));
  return heading ? heading.slice(2).trim() : fallback;
}

/** Every guide except the index, in the order the directory lists them. */
export function listDocs(): DocMeta[] {
  let files: string[];
  try {
    files = readdirSync(DOCS_DIR);
  } catch {
    return [];   // no docs shipped with this build
  }
  return files
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => f.replace(/\.md$/, ''))
    .filter(slug => SLUG_RE.test(slug))
    .sort()
    .map(slug => ({ slug, title: titleOf(readRaw(slug) ?? '', slug) }));
}

function readRaw(slug: string): string | null {
  if (!SLUG_RE.test(slug)) return null;
  try {
    return readFileSync(join(DOCS_DIR, `${slug}.md`), 'utf8');
  } catch {
    return null;
  }
}

/** The index page is `docs/README.md` — the same one GitHub shows, so the
 *  guide list lives in exactly one place. */
export function readIndex(): string | null {
  try {
    return readFileSync(join(DOCS_DIR, 'README.md'), 'utf8');
  } catch {
    return null;
  }
}

export function readDoc(slug: string): { title: string; markdown: string } | null {
  const markdown = readRaw(slug);
  if (markdown === null) return null;
  return { title: titleOf(markdown, slug), markdown };
}

/**
 * Markdown to HTML, with the links rewritten for the app.
 *
 * The guides cross-link as `operating.md#dupes` and embed `images/foo.png`,
 * both correct on GitHub. Here they are rewritten to absolute `/docs/...`
 * paths rather than left relative: a relative link resolves against the
 * *directory* of the current URL, so `getting-started` works from
 * `/docs/operating` but lands on `/getting-started` from the index at
 * `/docs`. Absolute paths behave the same from every page.
 *
 * Absolute and external links are left alone.
 */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: false });
  return addHeadingIds(withAppLinks(html));
}

/** GitHub's heading slug, so the `#anchor` in a cross-link written for GitHub
 *  lands on the same section here. Without ids the link resolves to the right
 *  page and then sits at the top of it, which is worse than it sounds in a
 *  reference like the API guide. */
function slugify(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')          // heading may contain inline code
    // Every entity, numeric ones included. The markdown renderer emits an
    // apostrophe as `&#39;`, which a named-entity-only strip left behind as a
    // literal "39" in the middle of the slug — so every heading with an
    // apostrophe got an id GitHub would never produce, and a cross-link
    // written for GitHub resolved here to the top of the page instead of the
    // section. Silent by construction: the link is valid, it just lands wrong.
    .replace(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function addHeadingIds(html: string): string {
  const seen = new Map<string, number>();
  return html.replace(/<h([2-4])>(.*?)<\/h\1>/g, (_m, level: string, inner: string) => {
    const base = slugify(inner);
    if (!base) return `<h${level}>${inner}</h${level}>`;
    // Duplicate headings get -1, -2 … exactly as GitHub numbers them.
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const id = n === 0 ? base : `${base}-${n}`;
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
}

function withAppLinks(html: string): string {
  return html
    // The index is `docs/README.md` on GitHub but is served at `/docs`, not at
    // a slug — `SLUG_RE` is lower-case only, so `/docs/README` is not a page.
    // Without this a guide linking its own index 404s in the app while working
    // on GitHub, which is the one direction nothing here would notice.
    .replace(
      /href="(?!https?:|\/|#)README\.md(#[^"]*)?"/g,
      (_m, hash: string | undefined) => `href="/docs${hash ?? ''}"`,
    )
    .replace(
      /href="(?!https?:|\/|#)([^"]*?)\.md(#[^"]*)?"/g,
      (_m, path: string, hash: string | undefined) => `href="/docs/${path}${hash ?? ''}"`,
    )
    .replace(
      /src="(?!https?:|\/)images\/([^"]+)"/g,
      (_m, file: string) => `src="/docs/images/${file}"`,
    );
}

/** Files under `docs/images/`, served by the docs image route. Same basename
 *  rule as the slugs, for the same reason. */
export function readDocImage(name: string): Buffer | null {
  if (!/^[a-z0-9._-]+$/i.test(name) || name.includes('..')) return null;
  try {
    return readFileSync(join(DOCS_DIR, 'images', name));
  } catch {
    return null;
  }
}
