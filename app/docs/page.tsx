import { readIndex, renderMarkdown } from '@/lib/docs';
import DocBody from '@/components/DocBody';

export const metadata = { title: 'Documentation – EzFD' };

export default function DocsIndexPage() {
  const markdown = readIndex();
  if (!markdown) {
    return (
      <p className="text-sm text-zinc-400 light:text-zinc-600">
        No documentation shipped with this build.
      </p>
    );
  }
  return <DocBody html={renderMarkdown(markdown)} />;
}
