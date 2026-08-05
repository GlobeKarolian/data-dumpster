import type { ReactNode } from 'react';

export function PublicDocument({
  eyebrow,
  title,
  summary,
  effectiveDate,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  effectiveDate?: string;
  children: ReactNode;
}) {
  return (
    <main>
      <article className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-700 dark:text-accent-400">
            {eyebrow}
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
          <p className="mt-6 text-lg leading-8 text-zinc-600 dark:text-zinc-300">{summary}</p>
          {effectiveDate ? (
            <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
              Effective {effectiveDate}
            </p>
          ) : null}
        </header>
        <div className="mt-12 space-y-12 border-t border-zinc-200 pt-10 dark:border-zinc-800">
          {children}
        </div>
      </article>
    </main>
  );
}

export function DocumentSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="max-w-3xl">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 text-base leading-7 text-zinc-600 dark:text-zinc-300">
        {children}
      </div>
    </section>
  );
}

export function DocumentList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-zinc-400">{children}</ul>;
}
