import Link from 'next/link';
import { DumpsterLogo } from '@/components/shell/logo';

const policyLinks = [
  { href: '/about', label: 'Product' },
  { href: '/about/privacy', label: 'Privacy' },
  { href: '/about/data-deletion', label: 'Data deletion' },
  { href: '/about/terms', label: 'Terms' },
] as const;

export default function AboutLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-dvh bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <header className="sticky top-0 z-50 border-b border-zinc-200/80 bg-white/80 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-950/80">
        <div className="mx-auto grid max-w-7xl gap-3 px-6 py-3.5 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div className="flex items-center justify-between gap-4">
            <Link href="/about" aria-label="Data Dumpster product information">
              <DumpsterLogo />
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold transition-colors hover:bg-zinc-100 sm:hidden dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Sign in
            </Link>
          </div>
          <div className="hidden items-center justify-between gap-1 sm:flex sm:justify-end">
            <nav aria-label="Product policies" className="flex flex-1 items-center justify-between sm:flex-none sm:justify-start">
              {policyLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-2 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 sm:px-2.5 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <Link
              href="/login"
              className="ml-1 hidden rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold transition-colors hover:bg-zinc-100 sm:inline-flex dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {children}

      <footer className="border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-10 text-sm leading-6 text-zinc-500 sm:flex-row sm:items-end sm:justify-between dark:text-zinc-400">
          <div>
            <p className="font-semibold text-zinc-800 dark:text-zinc-200">
              Boston Globe Media Partners, LLC
            </p>
            <p>One Exchange Place, Boston, Massachusetts 02109</p>
          </div>
          <p>
            {policyLinks.map((item, index) => (
              <span key={item.href}>
                {index > 0 ? ' · ' : ''}
                <Link className="underline underline-offset-4" href={item.href}>{item.label}</Link>
              </span>
            ))}
            <br />
            <a className="underline underline-offset-4" href="https://www.bostonglobemedia.com/about/">
              About Boston Globe Media
            </a>{' '}
            ·{' '}
            <a className="underline underline-offset-4" href="https://www.bostonglobemedia.com/contact/">
              Contact
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
