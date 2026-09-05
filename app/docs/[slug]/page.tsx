import Link from 'next/link';
import { notFound } from 'next/navigation';
import { docsOrder, listDocs, readDoc, renderMarkdown } from '@/lib/docs';
import DocBody from '@/components/DocBody';

export async function generateStaticParams() {
  return listDocs().map(d => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = readDoc(slug);
  return { title: doc ? `${doc.title} – EzFD docs` : 'Documentation – EzFD' };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = readDoc(slug);
  if (!doc) notFound();

  // The guides are written to be read in the index's order, and until now the
  // only way to follow it was to go back to the sidebar and find where you
  // had got to.
  const order = docsOrder();
  const at = order.findIndex(d => d.slug === slug);
  const prev = at > 0 ? order[at - 1] : null;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;

  return (
    <>
      <DocBody html={renderMarkdown(doc.markdown)} />

      {(prev || next) && (
        <nav
          aria-label="More guides"
          className="mt-10 flex max-w-3xl flex-wrap items-stretch justify-between gap-3 border-t border-zinc-800 pt-6 light:border-zinc-200"
        >
          {/* Each card names the guide rather than saying only "Previous", so
              the choice can be made without clicking to find out. */}
          {prev ? (
            <Link
              href={`/docs/${prev.slug}`}
              className="group min-w-0 flex-1 rounded-lg border border-zinc-800 px-3 py-2 hover:border-zinc-600 light:border-zinc-200 light:hover:border-zinc-400"
            >
              <div className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Previous</div>
              <div className="truncate text-sm text-zinc-300 group-hover:text-amber-400 light:text-zinc-700">
                ← {prev.title}
              </div>
            </Link>
          ) : (
            <span className="flex-1" />
          )}
          {next && (
            <Link
              href={`/docs/${next.slug}`}
              className="group min-w-0 flex-1 rounded-lg border border-zinc-800 px-3 py-2 text-right hover:border-zinc-600 light:border-zinc-200 light:hover:border-zinc-400"
            >
              <div className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Next</div>
              <div className="truncate text-sm text-zinc-300 group-hover:text-amber-400 light:text-zinc-700">
                {next.title} →
              </div>
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
