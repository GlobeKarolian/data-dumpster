'use client';

import type { PublishPlatform, PublishProvider } from '@/lib/publishing/platforms';

export interface Rule { weekday: number; startMinute: number; endMinute: number }

export interface Target {
  id: string;
  brand: string;
  platform: PublishPlatform;
  label: string;
  handle: string | null;
  provider: PublishProvider;
  has_secret: boolean;
  channel_id: string | null;
  utm: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  rules: Rule[];
  min_gap_minutes: number;
  max_per_day: number | null;
  bio_page_id: string | null;
  active: boolean;
}

export interface Delivery {
  id: string;
  post_id: string;
  target_id: string;
  brand: string;
  platform: PublishPlatform;
  label: string;
  final_text: string;
  link_url: string | null;
  link_mode: 'card' | 'text' | 'bio';
  status: 'held' | 'queued' | 'sending' | 'sent' | 'failed' | 'canceled' | 'unschedulable';
  scheduled_for: string | null;
  slot_reason: string | null;
  attempts: number;
  provider: string | null;
  post_url: string | null;
  last_error: string | null;
  sent_at: string | null;
}

export interface Post {
  id: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'canceled';
  origin: string;
  base_copy: string;
  link_url: string | null;
  link_title: string | null;
  media_urls: string[];
  timing: { mode: 'exact'; at: string } | { mode: 'window'; start: string; end: string };
  notes: string | null;
  created_by_email: string | null;
  approved_by_email: string | null;
  created_at: string;
  deliveries: Delivery[];
}

export interface Plan {
  targetId: string;
  platform: PublishPlatform;
  label: string;
  brand: string;
  linkUrl: string | null;
  linkMode: 'card' | 'text' | 'bio';
  finalText: string;
  length: number;
  limit: number;
  problems: string[];
  slot: { at: string; reason: string } | null;
  slotError: string | null;
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.json !== undefined ? { 'content-type': 'application/json' } : {}), ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fields = (body.fields as { path: string; message: string }[] | undefined)?.map((f) => `${f.path}: ${f.message}`).join('; ');
    throw new Error(fields || body.error || `Request failed (${res.status}).`);
  }
  return body as T;
}

const TZ = 'America/New_York';
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

export function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Value for <input type="datetime-local"> in the browser's zone. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function minuteLabel(m: number): string {
  if (m === 1440) return '12am';
  const h = Math.floor(m / 60), mm = m % 60;
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mm ? `${h12}:${String(mm).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
}

export const STATUS_TONE: Record<Delivery['status'], 'neutral' | 'accent' | 'positive' | 'warning' | 'critical' | 'outline'> = {
  held: 'warning', queued: 'accent', sending: 'accent', sent: 'positive', failed: 'critical', canceled: 'outline', unschedulable: 'critical',
};
export const STATUS_LABEL: Record<Delivery['status'], string> = {
  held: 'Awaiting approval', queued: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'Failed', canceled: 'Canceled', unschedulable: 'No slot',
};
