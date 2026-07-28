import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-baseline gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-600">Pressbox</span>
          <span className="pb-num text-xs text-zinc-400 dark:text-zinc-600">404</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          That page is not part of this landscape.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          The route you asked for does not exist. If you followed a link from a brief or a shared
          dashboard, the underlying landscape or report may since have been renamed or deleted.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Link
            href="/cross-channel"
            className="inline-flex h-9 items-center rounded-md bg-accent-600 px-3 text-sm font-medium text-white transition-colors hover:bg-accent-700"
          >
            Go to Cross-Channel
          </Link>
          <Link
            href="/settings/companies"
            className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Manage landscapes
          </Link>
        </div>
      </div>
    </div>
  );
}
