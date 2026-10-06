import type { Metadata } from 'next';
import { PublishCalendar } from '@/components/publishing/calendar';
import { publishingPageContext } from '../_gate';

export const metadata: Metadata = { title: 'Publishing Calendar' };

export default async function PublishCalendarPage() {
  const { live } = await publishingPageContext();
  return <PublishCalendar live={live} />;
}
