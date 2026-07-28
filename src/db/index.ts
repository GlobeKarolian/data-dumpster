import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

/**
 * Lazily-constructed database client.
 *
 * This is deliberately a Proxy rather than a module-level `drizzle(...)` call.
 * Next.js evaluates every route module during `next build` to collect metadata,
 * and a top-level throw here would fail the build on any machine that does not
 * happen to have a database URL in its environment. CI and Vercel's build step
 * both fall into that category. Deferring the connection means the app builds
 * anywhere and only demands a real database when a request actually needs one,
 * which is also when the error message is useful to whoever is reading it.
 */
type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

let client: DrizzleClient | null = null;

function connectionString(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Create a Postgres database (on Vercel: Storage > ' +
      'Create Database > Neon) and add its pooled connection string as DATABASE_URL. ' +
      'See docs/DEPLOY.md.',
    );
  }
  return url;
}

export function getDb(): DrizzleClient {
  if (!client) client = drizzle(neon(connectionString()), { schema });
  return client;
}

/** True when a database URL is configured. Lets health checks answer without throwing. */
export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);
}

/**
 * The ambient client every caller imports. Property access forwards to the real
 * client, constructing it on first use.
 */
export const db = new Proxy({} as DrizzleClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
  apply(_target, thisArg, args) {
    return Reflect.apply(getDb() as unknown as (...a: unknown[]) => unknown, thisArg, args);
  },
});

export { schema };
export type Db = DrizzleClient;
