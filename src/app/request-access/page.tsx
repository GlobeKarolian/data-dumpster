import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { RequestAccessForm } from '@/components/auth/request-access-form';
import { RequestAccessHero } from '@/components/auth/request-access-hero';
import { DumpsterLogo } from '@/components/shell/logo';

export const metadata: Metadata = {
  title: 'Request access',
  description: 'Request access to Data Dumpster.',
};

export default function RequestAccessPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-black text-zinc-950">
      <RequestAccessHero />

      <div className="relative z-10 flex min-h-dvh items-center px-4 py-8 sm:px-8 lg:px-16">
        <div className="mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-white/30 bg-white/95 shadow-2xl shadow-black/50 backdrop-blur-md dark:bg-white/95">
          <section className="p-7 sm:p-9">
            <DumpsterLogo className="mb-8" forceLight />
            <h1 className="text-2xl font-semibold tracking-tight">Request access</h1>
            <p className="mt-1 mb-7 text-sm text-zinc-500">Use your work email so we know where to send the decision.</p>
            <RequestAccessForm />
            <Link href="/login" className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-950">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Already have an account? Sign in
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
