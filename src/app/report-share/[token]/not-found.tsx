export default function SharedReportNotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-100 px-6 dark:bg-zinc-950">
      <div className="max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-white">This report link is no longer available</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          It may have been revoked or replaced. Ask the report owner for a new public link.
        </p>
      </div>
    </main>
  );
}
