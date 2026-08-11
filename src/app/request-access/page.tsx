import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, BellRing, KeyRound, ShieldCheck } from 'lucide-react';
import { RequestAccessForm } from '@/components/auth/request-access-form';
import { DumpsterLogo } from '@/components/shell/logo';

export const metadata: Metadata = {
  title: 'Request access',
  description: 'Request access to Data Dumpster.',
};

export default function RequestAccessPage() {
  return (
    <main className="min-h-dvh bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <DumpsterLogo forceLight />
        <div className="mt-10 grid overflow-hidden rounded-2xl border border-zinc-200 bg-white lg:grid-cols-[0.9fr_1.1fr]">
          <section className="border-b border-zinc-200 bg-zinc-950 p-7 text-white lg:border-b-0 lg:border-r lg:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-400">Get inside</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              Ask for access. Skip the invite chase.
            </h1>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-zinc-300">
              Tell us who you are. A Data Dumpster administrator will review your request and
              send a secure account-setup link if it is approved.
            </p>
            <ul className="mt-9 space-y-5 text-sm text-zinc-200">
              <li className="flex gap-3"><BellRing className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden /><span>The administrators are alerted automatically.</span></li>
              <li className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden /><span>No access is granted until a person approves it.</span></li>
              <li className="flex gap-3"><KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden /><span>Approval creates a private, single-use setup link.</span></li>
            </ul>
          </section>

          <section className="p-7 lg:p-10">
            <h2 className="text-xl font-semibold tracking-tight">Request access</h2>
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
