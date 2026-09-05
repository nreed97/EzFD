'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { DocGroup } from '@/lib/docs';

/**
 * The documentation sidebar.
 *
 * Grouped and ordered by `docs/README.md`, which already sorts the guides by
 * who is reading them — see `docsNav()`. The list used to be flat and
 * alphabetical, which put Administration above Architecture above Changelog
 * and left an operator to guess which of the seventeen was theirs.
 *
 * A client component only for `usePathname`. Reading a guide with no
 * indication of where you are in the set is the part that made the sidebar
 * feel like a list of files rather than a table of contents.
 */

interface Props {
  groups: DocGroup[];
  /** Shown as the first entry, since the index is a page in its own right. */
  indexLabel?: string;
}

export default function DocsNav({ groups, indexLabel = 'All guides' }: Props) {
  const pathname = usePathname();
  const onIndex = pathname === '/docs';
  const current = groups
    .flatMap(g => g.docs)
    .find(d => pathname === `/docs/${d.slug}`);

  const link = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`block rounded px-2 py-1 text-sm transition-colors ${
        active
          ? 'bg-amber-400/10 font-semibold text-amber-400 light:bg-amber-100 light:text-amber-800'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 light:text-zinc-600 light:hover:bg-zinc-100 light:hover:text-zinc-900'
      }`}
    >
      {label}
    </Link>
  );

  const list = (
    <ul className="flex flex-col gap-4">
      <li>{link('/docs', indexLabel, onIndex)}</li>
      {groups.map(group => (
        <li key={group.title}>
          <div className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-zinc-500">
            {group.title}
          </div>
          <ul className="flex flex-col gap-0.5">
            {group.docs.map(d => (
              <li key={d.slug}>{link(`/docs/${d.slug}`, d.title, d.slug === current?.slug)}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );

  return (
    <nav className="shrink-0 md:w-60" aria-label="Documentation">
      {/* On a phone the full list is most of a screen to scroll past before
          reaching the guide itself, so it collapses — open on the index, where
          choosing a guide is the whole point of the page, and shut on a guide,
          where you came to read. `details` rather than state: no hydration, and
          it works before the JS lands.

          Two renders, breakpoint-switched, rather than one `details` unwrapped
          by CSS above `md`. Chromium hides a shut `details` with
          `content-visibility` on its internal slot, not with `display` on the
          children, so an author `display: block` does not reveal it and the
          desktop sidebar simply vanishes. The duplicate costs some markup and
          nothing else: `display: none` removes the hidden copy from the
          accessibility tree, so each guide is still one link to a reader.

          Verified at three widths, by visibility rather than by text content —
          `textContent` reads a hidden element perfectly well, which is exactly
          how the CSS-only version looked like it worked. */}
      <details open={onIndex} className="md:hidden">
        <summary className="cursor-pointer list-none rounded border border-zinc-800 px-3 py-2 text-sm text-zinc-300 light:border-zinc-200 light:text-zinc-700">
          {current ? current.title : indexLabel}
          <span className="float-right text-zinc-500">▾</span>
        </summary>
        <div className="pt-3">{list}</div>
      </details>

      <div className="hidden md:block">{list}</div>
    </nav>
  );
}
