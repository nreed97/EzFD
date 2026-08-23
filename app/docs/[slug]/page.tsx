import { notFound } from 'next/navigation';
import { listDocs, readDoc, renderMarkdown } from '@/lib/docs';
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
  return <DocBody html={renderMarkdown(doc.markdown)} />;
}
