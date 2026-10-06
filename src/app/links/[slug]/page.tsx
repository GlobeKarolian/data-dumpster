import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { publicBioPage } from '@/lib/publishing/store';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const data = await publicBioPage(slug).catch(() => null);
  return { title: data ? data.page.title : 'Links', robots: { index: false, follow: true } };
}

/**
 * A brand's link in bio. Shows only links that are live right now: scheduled
 * links appear the minute their Instagram or TikTok post goes up, and expired
 * ones drop off on their own. No chrome, no sign-in, no tracking scripts.
 */
export default async function LinksPage({ params }: Params) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{2,41}$/.test(slug)) notFound();
  const data = await publicBioPage(slug);
  if (!data) notFound();
  const { page, links } = data;
  return (
    <main className="min-h-dvh bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <div className="mx-auto w-full max-w-md">
        <header className="mb-6 flex flex-col items-center gap-3 text-center">
          {page.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.avatar_url} alt="" className="h-20 w-20 rounded-full object-cover" />
          ) : null}
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{page.title}</h1>
        </header>
        {links.length === 0 ? (
          <p className="text-center text-sm text-zinc-500">No links right now.</p>
        ) : (
          <ul className="space-y-3">
            {links.map((l) => (
              <li key={l.id}>
                <a
                  href={l.url}
                  rel="noopener"
                  className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-sm transition hover:border-zinc-300 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                >
                  {l.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.image_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                  ) : null}
                  <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug text-zinc-900 dark:text-zinc-100">
                    {l.title}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
