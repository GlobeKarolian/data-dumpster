/**
 * The Auth.js catch-all endpoint: sign-in, sign-out, session, CSRF, callbacks.
 *
 * Pinned to the Node runtime because the credentials provider hashes with
 * bcryptjs and reads Postgres, neither of which belongs on the edge.
 */
import { handlers } from '@/auth';

export const runtime = 'nodejs';

export const { GET, POST } = handlers;
