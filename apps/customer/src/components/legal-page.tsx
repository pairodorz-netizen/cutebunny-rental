import { MDXRemote } from 'next-mdx-remote/rsc';

interface LegalPageProps {
  content: string;
}

export function LegalPage({ content }: LegalPageProps) {
  return (
    <article className="container max-w-3xl py-12 px-4">
      <div className="prose prose-neutral max-w-none prose-headings:font-serif prose-h1:text-3xl prose-h2:text-xl prose-h3:text-lg prose-table:text-sm prose-td:py-2 prose-th:py-2">
        <MDXRemote source={content} />
      </div>
    </article>
  );
}
