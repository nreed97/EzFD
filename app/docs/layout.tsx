import Link from 'next/link';
import { listDocs } from '@/lib/docs';
import ThemeToggle from '@/components/ThemeToggle';

/**
 * The documentation shell: a sidebar of every guide plus the rendered page.
 *
 * The guides ship with the app rather than living only on GitHub, because the
 * people who most need them — an operator mid-event, someone setting up a
 * field server with no internet — are exactly the people who can't reach
 * GitHub at the time.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const docs = listDocs();
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 light:border-zinc-200">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="font-bold text-amber-400 hover:text-amber-300">EzFD</Link>
          <span className="text-zinc-700 light:text-zinc-300">/</span>
          <Link href="/docs" className="text-sm font-semibold text-zinc-200 light:text-zinc-800">Documentation</Link>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/"
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
          >
            Back to app
          </Link>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 px-4 py-6 md:flex-row">
        <nav className="shrink-0 md:w-56">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 md:flex-col md:gap-1">
            {docs.map(d => (
              <li key={d.slug}>
                <Link
                  href={`/docs/${d.slug}`}
                  className="block rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 light:text-zinc-600 light:hover:bg-zinc-100 light:hover:text-zinc-900"
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
