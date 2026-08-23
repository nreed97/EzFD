/**
 * Rendered markdown, styled to match the app.
 *
 * The HTML comes from `docs/*.md` — files checked into this repository and
 * rendered on the server — so it is trusted content, not user input. Nothing
 * an operator types reaches this component.
 */
export default function DocBody({ html }: { html: string }) {
  return (
    <article
      className="doc-body max-w-3xl text-zinc-300 light:text-zinc-700"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
