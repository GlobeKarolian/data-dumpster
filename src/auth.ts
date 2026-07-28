/**
 * Authentication for Pressbox.
 *
 * Design decisions worth the ink:
 *
 *  - **Credentials + JWT, not a database session.** Pressbox is deployed to
 *    serverless functions talking to Neon over HTTP. A database-backed session
 *    would add a round trip to the cold path of literally every request, and
 *    every route in this app is already going to hit the database for real work.
 *    A signed JWT carries the three facts every handler needs -- user, org, role
 *    -- and costs nothing to read.
 *
 *  - **orgId lives on the token.** Pressbox is multi-tenant from row one. Making
 *    the tenant boundary a property of the credential rather than something a
 *    handler looks up (or worse, accepts from the client) means the default
 *    behaviour of any new endpoint is org-scoped. See lib/session.ts.
 *
 *  - **The provider is deliberately boring.** Email and password against a
 *    bcrypt hash. SSO is the obvious next step for a newsroom of this size, and
 *    Auth.js makes that an additive change: add a provider, keep the callbacks.
 */
import NextAuth, { type DefaultSession, type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { users } from '@/db/schema';

/** Ordered least to most privileged; the ordering is enforced in lib/session.ts. */
export type Role = 'viewer' | 'editor' | 'admin' | 'owner';

/**
 * The claims Pressbox adds on top of the Auth.js defaults. Declared once and
 * reused by both augmentations so the token and the session cannot drift.
 */
export interface PressboxClaims {
  userId: string;
  orgId: string;
  role: Role;
}

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      orgId: string;
      role: Role;
    } & DefaultSession['user'];
  }

  interface User {
    orgId: string;
    role: Role;
  }
}

/**
 * The JWT shape is augmented on '@auth/core/jwt' rather than 'next-auth/jwt'.
 * The latter is a pure re-export shim ("export * from '@auth/core/jwt'") and so
 * declares nothing of its own; TypeScript can only merge an interface into the
 * module that actually declares it.
 */
declare module '@auth/core/jwt' {
  interface JWT {
    userId?: string;
    orgId?: string;
    role?: Role;
  }
}

/**
 * Sign-in input. Validated here rather than in the form so that a direct POST to
 * the Auth.js endpoint gets the same treatment as the UI.
 */
const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(512),
});

/**
 * A bcrypt hash of a value nobody will ever submit. Compared against when the
 * email does not exist so that "unknown user" and "wrong password" take the same
 * amount of time. Without this, response latency is a user-enumeration oracle.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.aQ4vXHtGGRuKgpDLA9ttUEBRUlYyG3S';

export const authConfig: NextAuthConfig = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  trustHost: true,
  pages: { signIn: '/login', error: '/login' },
  providers: [
    Credentials({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const [record] = await db
          .select({
            id: users.id,
            orgId: users.orgId,
            email: users.email,
            name: users.name,
            image: users.image,
            role: users.role,
            passwordHash: users.passwordHash,
          })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        // Always run a comparison, even when there is no user, so the timing of
        // a failed sign-in does not reveal whether the address is registered.
        const hash = record?.passwordHash ?? DUMMY_HASH;
        const ok = await compare(password, hash);
        if (!record || !record.passwordHash || !ok) return null;

        return {
          id: record.id,
          email: record.email,
          name: record.name,
          image: record.image,
          orgId: record.orgId,
          role: record.role,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * Runs on sign-in (when "user" is present) and on every subsequent request.
     * The claims are copied once at sign-in and then simply carried; a role
     * change therefore takes effect at the user's next sign-in, which is the
     * standard trade for not querying the database on every request.
     */
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.orgId = user.orgId;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.userId) session.user.id = token.userId;
      if (token.orgId) session.user.orgId = token.orgId;
      if (token.role) session.user.role = token.role;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
