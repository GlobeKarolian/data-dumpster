/**
 * Invitations, and the membership reads that always accompany them.
 *
 * ROLE SEMANTICS -- the authoritative statement.
 *
 * lib/session.ts orders roles viewer < editor < admin < owner, and requireRole
 * takes a minimum, so requireRole('admin') admits admins and owners. The four
 * descriptions below match that ordering exactly and are mirrored, compressed,
 * in lib/roles.ts where the invite form reads them.
 *
 *   viewer  Reads everything. Every landscape, dashboard, brief, report and
 *           post. Changes nothing.
 *   editor  Everything a viewer can do, plus adds channels and companies and
 *           edits post tags and weekly reports.
 *   admin   Everything an editor can do, plus manages users, data sources and
 *           model connections.
 *   owner   Everything, including billing-level settings and transferring
 *           ownership. Only an owner may grant the owner role, and the last
 *           owner in an org can be neither demoted nor removed.
 *
 * WHY NOTHING HERE SENDS EMAIL
 *
 * This module only mints and accepts credentials; it does not deliver them.
 * Manual invitations are handed over directly. The access-request workflow may
 * email the link after approval, but that orchestration lives in
 * lib/access-requests.ts so the token primitive remains transport-agnostic.
 *
 * THE TOKEN IS THE CREDENTIAL
 *
 * Thirty-two bytes from node:crypto randomBytes, base64url encoded. Never
 * sequential, never derived from the email, never regenerated. It expires after
 * seven days by default and is single use: accepting is one SQL statement that
 * both inserts the user and stamps the invite, so a half-accepted invite cannot
 * exist even if the process dies mid-request.
 */
import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hash } from 'bcryptjs';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { invites, orgs, users } from '@/db/schema';
import type { Role } from '@/lib/roles';

/** 32 bytes is 256 bits of entropy; base64url renders it as 43 characters. */
export const INVITE_TOKEN_BYTES = 32;
export const DEFAULT_INVITE_DAYS = 7;
/** Long over complex. A twelve-character minimum with no composition rules. */
export const MIN_PASSWORD_LENGTH = 12;
/** Matches the cost factor used everywhere else a password is hashed. */
const BCRYPT_ROUNDS = 12;

export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

/**
 * Compare two tokens without letting the comparison time say how much of the
 * guess was right.
 *
 * Being honest about what this does and does not buy: the row is fetched with
 * an indexed equality, and a btree probe is not itself constant time. What this
 * guarantees is that nothing downstream of the fetch -- the verification that
 * decides whether an invitation is honoured -- leaks a prefix. Against 256 bits
 * of entropy the remaining signal is not a practical attack, and the check
 * costs a microsecond.
 */
function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** What the accept screen needs to tell someone what they are accepting. */
export interface InviteView {
  id: string;
  orgId: string;
  orgName: string;
  email: string;
  role: Role;
  invitedByName: string | null;
  invitedByEmail: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

export type InviteStatus = 'valid' | 'expired' | 'accepted' | 'unknown';

/**
 * Four outcomes, not two. An expired invitation, a spent one and a fabricated
 * one are three different situations for the person holding the link, and
 * collapsing them into one "invalid invite" screen turns a thirty-second fix
 * into a support conversation.
 */
export type InviteLookup =
  | { status: 'unknown'; invite: null }
  | { status: 'valid' | 'expired' | 'accepted'; invite: InviteView };

export async function lookupInvite(token: string): Promise<InviteLookup> {
  const candidate = token.trim();
  // A token is always 43 characters. Anything wildly off is not worth a query.
  if (candidate.length < 16 || candidate.length > 256) {
    return { status: 'unknown', invite: null };
  }

  const [row] = await db
    .select({
      id: invites.id,
      orgId: invites.orgId,
      orgName: orgs.name,
      email: invites.email,
      role: invites.role,
      token: invites.token,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      createdAt: invites.createdAt,
      invitedByName: users.name,
      invitedByEmail: users.email,
    })
    .from(invites)
    .innerJoin(orgs, eq(orgs.id, invites.orgId))
    .leftJoin(users, eq(users.id, invites.invitedBy))
    .where(eq(invites.token, candidate))
    .limit(1);

  if (!row || !tokensMatch(row.token, candidate)) {
    return { status: 'unknown', invite: null };
  }

  const invite: InviteView = {
    id: row.id,
    orgId: row.orgId,
    orgName: row.orgName,
    email: row.email,
    role: row.role,
    invitedByName: row.invitedByName,
    invitedByEmail: row.invitedByEmail,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
  };

  if (invite.acceptedAt) return { status: 'accepted', invite };
  if (invite.expiresAt.getTime() <= Date.now()) return { status: 'expired', invite };
  return { status: 'valid', invite };
}

/** Unexpired and unaccepted, or nothing. */
export async function findValidInvite(token: string): Promise<InviteView | null> {
  const found = await lookupInvite(token);
  return found.status === 'valid' ? found.invite : null;
}

export interface CreateInviteInput {
  orgId: string;
  email: string;
  role: Role;
  invitedByUserId: string;
  expiresInDays?: number;
}

export interface CreatedInvite {
  id: string;
  email: string;
  role: Role;
  /** The only moment this value is ever produced. Hand it over or lose it. */
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

export async function createInvite(input: CreateInviteInput): Promise<CreatedInvite> {
  const days = input.expiresInDays ?? DEFAULT_INVITE_DAYS;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(invites)
    .values({
      orgId: input.orgId,
      email: input.email.trim().toLowerCase(),
      role: input.role,
      token: generateInviteToken(),
      invitedBy: input.invitedByUserId,
      expiresAt,
    })
    .returning({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      token: invites.token,
      expiresAt: invites.expiresAt,
      createdAt: invites.createdAt,
    });

  return row;
}

export interface InviteListItem {
  id: string;
  email: string;
  role: Role;
  /** Present so an administrator can re-copy a link they lost in Slack. */
  token: string;
  invitedByName: string | null;
  invitedByEmail: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  expired: boolean;
}

/** Pending invitations for an org, newest first. Accepted ones on request. */
export async function listInvites(
  orgId: string,
  options: { includeAccepted?: boolean } = {},
): Promise<InviteListItem[]> {
  const where = options.includeAccepted
    ? eq(invites.orgId, orgId)
    : and(eq(invites.orgId, orgId), isNull(invites.acceptedAt));

  const rows = await db
    .select({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      token: invites.token,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      createdAt: invites.createdAt,
      invitedByName: users.name,
      invitedByEmail: users.email,
    })
    .from(invites)
    .leftJoin(users, eq(users.id, invites.invitedBy))
    .where(where)
    .orderBy(desc(invites.createdAt));

  const now = Date.now();
  return rows.map((r) => ({ ...r, expired: r.expiresAt.getTime() <= now }));
}

export type RevokeResult = 'revoked' | 'not_found' | 'already_accepted';

/**
 * Delete a pending invitation. An accepted one is refused rather than deleted:
 * it is the record of how somebody got in, and the user row it created is still
 * there. Removing the person is what the users endpoint is for.
 */
export async function revokeInvite(id: string, orgId: string): Promise<RevokeResult> {
  const [existing] = await db
    .select({ id: invites.id, acceptedAt: invites.acceptedAt })
    .from(invites)
    .where(and(eq(invites.id, id), eq(invites.orgId, orgId)))
    .limit(1);

  if (!existing) return 'not_found';
  if (existing.acceptedAt) return 'already_accepted';

  const [deleted] = await db
    .delete(invites)
    .where(and(eq(invites.id, id), eq(invites.orgId, orgId), isNull(invites.acceptedAt)))
    .returning({ id: invites.id });

  return deleted ? 'revoked' : 'already_accepted';
}

export interface OrgMember {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: Role;
  createdAt: Date;
  lastSeenAt: Date | null;
}

/** Membership and invitations are read together on every screen that shows either. */
export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      role: users.role,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
    })
    .from(users)
    .where(eq(users.orgId, orgId))
    .orderBy(desc(users.createdAt));
}

/** How many owners an org has. The last-owner guards are all built on this. */
export async function countOwners(orgId: string): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.role, 'owner')));
  return rows.length;
}

export interface AcceptInviteInput {
  token: string;
  name: string;
  /** Never logged, never returned, never written to a URL. */
  password: string;
}

export interface AcceptedUser {
  id: string;
  orgId: string;
  email: string;
  name: string | null;
  role: Role;
}

export type AcceptResult =
  | { ok: true; user: AcceptedUser }
  | { ok: false; reason: 'unknown' | 'expired' | 'accepted' | 'email_taken' | 'weak_password' };

interface AcceptRow extends Record<string, unknown> {
  user_id: string;
  org_id: string;
  email: string;
  name: string | null;
  role: Role;
}

/** Postgres unique violation, however many wrappers the driver put around it. */
function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Turn an invitation into a user, atomically.
 *
 * The neon-http driver has no interactive transactions, so the usual
 * begin/insert/update/commit is not available. One statement is better anyway:
 * a single data-modifying CTE chain is atomic by definition, and it closes the
 * race an interactive transaction would still leave open at READ COMMITTED.
 *
 * Reading it from the top: claimed locks the invitation row, which makes a
 * second person clicking the same link at the same moment wait and then find
 * nothing to claim. created inserts the user, inheriting org and role from the
 * invitation rather than from anything the browser sent. The final UPDATE
 * stamps the invitation, and it is the only write that touches that row, so
 * there is no double-update ambiguity.
 *
 * If the insert violates the unique email index the whole statement rolls back
 * and accepted_at is never set, so the invitation is still there to be used
 * once the collision is sorted out. A half-accepted invite cannot exist.
 */
export async function acceptInvite(input: AcceptInviteInput): Promise<AcceptResult> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: 'weak_password' };
  }

  const found = await lookupInvite(input.token);
  if (found.status !== 'valid') {
    return { ok: false, reason: found.status === 'unknown' ? 'unknown' : found.status };
  }

  const name = input.name.trim();
  const passwordHash = await hash(input.password, BCRYPT_ROUNDS);
  const inviteId = found.invite.id;

  let rows: AcceptRow[];
  try {
    const result = await db.execute<AcceptRow>(sql`
      WITH claimed AS (
        SELECT id, org_id, email, role
          FROM invites
         WHERE id = ${inviteId}::uuid
           AND accepted_at IS NULL
           AND expires_at > now()
           FOR UPDATE
      ),
      created AS (
        INSERT INTO users (org_id, email, name, password_hash, role)
        SELECT org_id, email, ${name}, ${passwordHash}, role FROM claimed
        RETURNING id, org_id, email, name, role
      )
      UPDATE invites
         SET accepted_at = now(), accepted_by_user_id = created.id
        FROM created
       WHERE invites.id = ${inviteId}::uuid
      RETURNING created.id AS user_id, created.org_id AS org_id,
                created.email AS email, created.name AS name, created.role AS role
    `);
    rows = [...result.rows];
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: 'email_taken' };
    throw err;
  }

  const row = rows[0];
  if (!row) {
    // Somebody claimed it in the milliseconds since the lookup, or it expired.
    const again = await lookupInvite(input.token);
    if (again.status === 'unknown') return { ok: false, reason: 'unknown' };
    if (again.status === 'expired') return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'accepted' };
  }

  return {
    ok: true,
    user: {
      id: row.user_id,
      orgId: row.org_id,
      email: row.email,
      name: row.name,
      role: row.role,
    },
  };
}

/**
 * The link an administrator hands over. Path segment, never a query parameter:
 * query strings end up in referrer headers and access logs more readily than
 * paths do, and this string is the credential.
 */
export function buildInviteUrl(origin: string, token: string): string {
  return origin.replace(/\/+$/, '') + '/invite/' + token;
}
