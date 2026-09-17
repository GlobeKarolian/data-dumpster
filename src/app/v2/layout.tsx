import * as React from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireOrg, AuthError } from '@/lib/session';
import './v2.css';
export const metadata: Metadata = { title: 'Editorial console · V2' };
export const dynamic = 'force-dynamic';
export default async function V2Layout({ children }: { children: React.ReactNode }) {
  try { await requireOrg(); } catch (error) { if (error instanceof AuthError && error.status === 401) redirect('/login'); throw error; }
  return <div className="dd-v2">{children}</div>;
}
