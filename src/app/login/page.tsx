import type { Metadata } from 'next';
import { AuthError } from 'next-auth';
import { signIn } from '@/auth';
import { LoginForm, type LoginState } from '@/components/auth/login-form';
import { DumpsterFireHero } from '@/components/auth/dumpster-fire-hero';
import { DumpsterLogo } from '@/components/shell/logo';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Data Dumpster.',
};

export const dynamic = 'force-dynamic';

/** Auth.js error codes, translated into something a person can act on. */
const ERROR_COPY: Record<string, string> = {
  CredentialsSignin: 'That email and password combination is not recognized.',
  Configuration: 'Authentication is not configured correctly on the server. Check AUTH_SECRET and DATABASE_URL.',
  AccessDenied: 'That account does not have access to this Data Dumpster instance.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string; next?: string }>;
}) {
  const params = await searchParams;
  const initialError = params.error
    ? (ERROR_COPY[params.error] ?? 'Sign-in failed. Try again, or contact whoever administers this instance.')
    : null;
  // The edge gate round-trips the destination as "next"; Auth.js uses "callbackUrl".
  const requested = params.next ?? params.callbackUrl;
  const callbackUrl = requested && requested.startsWith('/') ? requested : '/cross-channel';

  async function authenticate(_state: LoginState, formData: FormData): Promise<LoginState> {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    if (!email || !password) return { error: 'Enter both an email address and a password.' };

    try {
      await signIn('credentials', { email, password, redirectTo: callbackUrl });
      return { error: null };
    } catch (error) {
      if (error instanceof AuthError) {
        return {
          error:
            error.type === 'CredentialsSignin'
              ? 'That email and password combination is not recognized.'
              : 'Sign-in failed: ' + error.type + '.',
        };
      }
      // A successful signIn throws a redirect, which must be allowed through.
      throw error;
    }
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-black">
      <DumpsterFireHero />

      <section className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-8 sm:justify-start sm:px-8 lg:px-16">
        <div className="w-full max-w-sm rounded-2xl border border-white/30 bg-white/90 p-6 shadow-2xl shadow-black/40 backdrop-blur-md dark:bg-white/90 sm:p-8">
          <DumpsterLogo className="mb-8" forceLight />

          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-zinc-950">
            Welcome back, trash panda.
          </h1>
          <p className="mt-2 mb-7 text-sm leading-relaxed text-zinc-600">
            The data is messy. Your login shouldn’t be.
          </p>

          <LoginForm action={authenticate} initialError={initialError} />
        </div>
      </section>
    </main>
  );
}
