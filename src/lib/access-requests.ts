import 'server-only';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { accessRequests, invites, orgs, users } from '@/db/schema';
import { buildInviteUrl, DEFAULT_INVITE_DAYS, generateInviteToken } from '@/lib/invites';
import type { Role } from '@/lib/roles';

export const ACCESS_REQUEST_ORG_SLUG = 'boston-globe-media';

export interface AccessRequestInput {
  email: string;
  name: string;
  team?: string | null;
  reason?: string | null;
  origin: string;
}

export interface AccessRequestItem {
  id: string;
  email: string;
  name: string;
  team: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'declined';
  createdAt: Date;
}

export interface AccessEmailResult {
  status: 'sent' | 'not_configured' | 'failed';
  error: string | null;
}

function cleanOptional(value?: string | null): string | null {
  const clean = value?.trim();
  return clean ? clean : null;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : 'Unknown email delivery error').slice(0, 4_000);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function sendAccessEmail(input: {
  idempotencyKey: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}): Promise<AccessEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REPORT_FROM_EMAIL;
  if (!apiKey || !from) return { status: 'not_configured', error: null };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + apiKey,
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        tags: [{ name: 'feature', value: 'access_request' }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : 'HTTP ' + response.status;
      return { status: 'failed', error: 'Email provider rejected the message: ' + detail };
    }
    return { status: 'sent', error: null };
  } catch (error) {
    return { status: 'failed', error: errorText(error) };
  }
}

/** Create one pending request per org/email. Repeated submissions are harmless. */
export async function submitAccessRequest(input: AccessRequestInput): Promise<{
  created: boolean;
  requestId: string | null;
}> {
  const email = input.email.trim().toLowerCase();
  const [org] = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.slug, ACCESS_REQUEST_ORG_SLUG))
    .limit(1);
  if (!org) throw new Error('The access-request organization is not configured.');

  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existingUser) return { created: false, requestId: null };

  const [existing] = await db
    .select({ id: accessRequests.id })
    .from(accessRequests)
    .where(and(
      eq(accessRequests.orgId, org.id),
      eq(accessRequests.email, email),
      eq(accessRequests.status, 'pending'),
    ))
    .limit(1);
  if (existing) return { created: false, requestId: existing.id };

  let created: { id: string } | undefined;
  try {
    [created] = await db.insert(accessRequests).values({
      orgId: org.id,
      email,
      name: input.name.trim(),
      team: cleanOptional(input.team),
      reason: cleanOptional(input.reason),
    }).returning({ id: accessRequests.id });
  } catch (error) {
    // A second simultaneous submission can lose the partial-unique-index race.
    if (isUniqueViolation(error)) return { created: false, requestId: null };
    throw error;
  }

  const admins = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.orgId, org.id), inArray(users.role, ['admin', 'owner'])));
  const recipients = [...new Set(admins.map((row) => row.email.trim()).filter(Boolean))];

  let delivery: AccessEmailResult = { status: 'not_configured', error: null };
  if (recipients.length > 0) {
    const detail = [
      'Name: ' + input.name.trim(),
      'Email: ' + email,
      cleanOptional(input.team) ? 'Team: ' + cleanOptional(input.team) : null,
      cleanOptional(input.reason) ? 'Reason: ' + cleanOptional(input.reason) : null,
      '',
      'Review this request in Data Dumpster: ' + input.origin + '/settings/users',
    ].filter((line): line is string => line !== null).join('\n');
    const safeReason = cleanOptional(input.reason);
    const safeTeam = cleanOptional(input.team);
    delivery = await sendAccessEmail({
      idempotencyKey: 'data-dumpster-access-request-' + created.id,
      to: recipients,
      subject: 'Data Dumpster access request: ' + input.name.trim(),
      text: detail,
      html: '<h2>New Data Dumpster access request</h2>'
        + '<p><strong>' + escapeHtml(input.name.trim()) + '</strong><br>'
        + escapeHtml(email) + '</p>'
        + (safeTeam ? '<p><strong>Team</strong><br>' + escapeHtml(safeTeam) + '</p>' : '')
        + (safeReason ? '<p><strong>Why they need access</strong><br>' + escapeHtml(safeReason) + '</p>' : '')
        + '<p><a href="' + escapeHtml(input.origin + '/settings/users') + '">Review this request in Data Dumpster</a></p>',
    });
  }

  await db.update(accessRequests).set({
    requestNotificationSentAt: delivery.status === 'sent' ? new Date() : null,
    requestNotificationError: delivery.error,
    updatedAt: new Date(),
  }).where(eq(accessRequests.id, created.id));

  return { created: true, requestId: created.id };
}

export async function listPendingAccessRequests(orgId: string): Promise<AccessRequestItem[]> {
  const rows = await db.select({
    id: accessRequests.id,
    email: accessRequests.email,
    name: accessRequests.name,
    team: accessRequests.team,
    reason: accessRequests.reason,
    status: accessRequests.status,
    createdAt: accessRequests.createdAt,
  }).from(accessRequests)
    .where(and(eq(accessRequests.orgId, orgId), eq(accessRequests.status, 'pending')))
    .orderBy(desc(accessRequests.createdAt));

  return rows.map((row) => ({
    ...row,
    status: row.status as AccessRequestItem['status'],
  }));
}

interface ApproveRow extends Record<string, unknown> {
  request_id: string;
  email: string;
  name: string;
  invite_id: string;
  token: string;
  expires_at: Date;
}

export type DecideAccessResult =
  | { status: 'approved'; email: string; acceptUrl: string; delivery: AccessEmailResult }
  | { status: 'declined'; email: string; delivery: AccessEmailResult }
  | { status: 'not_found' | 'already_decided' | 'user_exists' };

export async function decideAccessRequest(input: {
  id: string;
  orgId: string;
  reviewerId: string;
  action: 'approve' | 'decline';
  role?: Role;
  origin: string;
}): Promise<DecideAccessResult> {
  const [request] = await db.select({
    id: accessRequests.id,
    email: accessRequests.email,
    name: accessRequests.name,
    status: accessRequests.status,
  }).from(accessRequests).where(and(
    eq(accessRequests.id, input.id),
    eq(accessRequests.orgId, input.orgId),
  )).limit(1);
  if (!request) return { status: 'not_found' };
  if (request.status !== 'pending') return { status: 'already_decided' };

  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, request.email)).limit(1);
  if (existingUser) return { status: 'user_exists' };

  if (input.action === 'decline') {
    const [declined] = await db.update(accessRequests).set({
      status: 'declined', reviewedBy: input.reviewerId, reviewedAt: new Date(), updatedAt: new Date(),
    }).where(and(
      eq(accessRequests.id, input.id),
      eq(accessRequests.orgId, input.orgId),
      eq(accessRequests.status, 'pending'),
    )).returning({ id: accessRequests.id });
    if (!declined) return { status: 'already_decided' };

    const delivery = await sendAccessEmail({
      idempotencyKey: 'data-dumpster-access-declined-' + input.id,
      to: [request.email],
      subject: 'Your Data Dumpster access request',
      text: 'Hi ' + request.name + ',\n\nYour Data Dumpster access request was not approved. If you believe this was a mistake, contact your Data Dumpster administrator.',
      html: '<p>Hi ' + escapeHtml(request.name) + ',</p><p>Your Data Dumpster access request was not approved. If you believe this was a mistake, contact your Data Dumpster administrator.</p>',
    });
    await recordDecisionDelivery(input.id, delivery);
    return { status: 'declined', email: request.email, delivery };
  }

  const [liveInvite] = await db.select({
    id: invites.id,
    token: invites.token,
  }).from(invites).where(and(
    eq(invites.orgId, input.orgId),
    eq(invites.email, request.email),
    isNull(invites.acceptedAt),
    gt(invites.expiresAt, new Date()),
  )).limit(1);

  if (liveInvite) {
    const [claimed] = await db.update(accessRequests).set({
      status: 'approved', reviewedBy: input.reviewerId, reviewedAt: new Date(),
      inviteId: liveInvite.id, updatedAt: new Date(),
    }).where(and(
      eq(accessRequests.id, input.id),
      eq(accessRequests.orgId, input.orgId),
      eq(accessRequests.status, 'pending'),
    )).returning({ id: accessRequests.id });
    if (!claimed) return { status: 'already_decided' };

    const acceptUrl = buildInviteUrl(input.origin, liveInvite.token);
    const delivery = await sendApprovalEmail({
      requestId: input.id,
      email: request.email,
      name: request.name,
      acceptUrl,
    });
    await recordDecisionDelivery(input.id, delivery);
    return { status: 'approved', email: request.email, acceptUrl, delivery };
  }

  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + DEFAULT_INVITE_DAYS * 86_400_000);
  const role = input.role ?? 'viewer';
  const result = await db.execute<ApproveRow>(sql`
    WITH claimed AS (
      SELECT id, org_id, email, name
        FROM access_requests
       WHERE id = ${input.id}::uuid
         AND org_id = ${input.orgId}::uuid
         AND status = 'pending'
       FOR UPDATE
    ), created AS (
      INSERT INTO invites (org_id, email, role, token, invited_by, expires_at)
      SELECT org_id, email, ${role}::role, ${token}, ${input.reviewerId}::uuid, ${expiresAt}
        FROM claimed
      RETURNING id, email, token, expires_at
    )
    UPDATE access_requests
       SET status = 'approved', reviewed_by = ${input.reviewerId}::uuid,
           reviewed_at = now(), updated_at = now(), invite_id = created.id
      FROM claimed, created
     WHERE access_requests.id = claimed.id
    RETURNING claimed.id AS request_id, claimed.email, claimed.name,
              created.id AS invite_id, created.token, created.expires_at
  `);
  const approved = result.rows[0];
  if (!approved) return { status: 'already_decided' };

  const acceptUrl = buildInviteUrl(input.origin, approved.token);
  const delivery = await sendApprovalEmail({
    requestId: input.id,
    email: approved.email,
    name: approved.name,
    acceptUrl,
  });
  await recordDecisionDelivery(input.id, delivery);
  return { status: 'approved', email: approved.email, acceptUrl, delivery };
}

async function sendApprovalEmail(input: {
  requestId: string;
  email: string;
  name: string;
  acceptUrl: string;
}): Promise<AccessEmailResult> {
  return sendAccessEmail({
    idempotencyKey: 'data-dumpster-access-approved-' + input.requestId,
    to: [input.email],
    subject: 'Your Data Dumpster access request was approved',
    text: 'Hi ' + input.name + ',\n\nYour request was approved. Create your account using this secure, single-use link within ' + DEFAULT_INVITE_DAYS + ' days:\n\n' + input.acceptUrl,
    html: '<p>Hi ' + escapeHtml(input.name) + ',</p><p>Your Data Dumpster access request was approved.</p>'
      + '<p><a href="' + escapeHtml(input.acceptUrl) + '">Create your account</a></p>'
      + '<p>This secure, single-use link expires in ' + DEFAULT_INVITE_DAYS + ' days.</p>',
  });
}

async function recordDecisionDelivery(id: string, delivery: AccessEmailResult): Promise<void> {
  await db.update(accessRequests).set({
    decisionNotificationSentAt: delivery.status === 'sent' ? new Date() : null,
    decisionNotificationError: delivery.error,
    updatedAt: new Date(),
  }).where(eq(accessRequests.id, id));
}

function isUniqueViolation(error: unknown): boolean {
  const direct = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
  const cause = typeof error === 'object' && error !== null
    ? (error as { cause?: { code?: unknown } }).cause?.code
    : null;
  return direct === '23505' || cause === '23505';
}
