import type { Metadata } from 'next';
import { AuthError } from 'next-auth';
import { signIn } from '@/auth';
import { LoginForm, type LoginState } from '@/components/auth/login-form';
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
    <div className="flex min-h-dvh">
      <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-[26rem] lg:shrink-0 lg:border-r lg:border-zinc-200 lg:px-10 dark:lg:border-zinc-800">
        <div className="mx-auto w-full max-w-sm">
          <DumpsterLogo className="mb-8" />

          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Sign in
          </h1>
          <p className="mt-1 mb-6 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Competitive social intelligence for the newsroom.
          </p>

          <LoginForm action={authenticate} initialError={initialError} />

          <p className="mt-6 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-600">
            Accounts are provisioned by an administrator. There is no self-service sign-up, because
            every account carries access to a full competitive picture of the newsroom.
          </p>
        </div>
      </div>

      <div className="hidden flex-1 items-center bg-zinc-50 px-12 lg:flex dark:bg-zinc-900/40">
        <div className="max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-600">
            What this is for
          </p>
          <h2 className="mt-3 text-2xl font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
            Every number defined. Every AI claim auditable. Every model your own.
          </h2>
          <ul className="mt-6 space-y-4">
            <li>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Numbers that survive a meeting
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Every metric carries its own definition, its arithmetic and its caveat. A percent
                change against a near-zero baseline is reported as unmeasurable rather than as a
                triumphant four-figure percentage.
              </p>
            </li>
            <li>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Prose you can check
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Briefs are generated from a fact sheet computed in advance, then every figure in the
                finished text is matched back against it without a model in the loop.
              </p>
            </li>
            <li>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Inference you control
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Point Data Dumpster at your own Anthropic account, your Azure deployment, or a box behind
                the firewall. No newsroom content goes anywhere the newsroom did not choose.
              </p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
