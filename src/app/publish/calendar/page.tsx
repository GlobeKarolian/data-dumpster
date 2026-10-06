import type { Metadata } from 'next';
import { PublishCalendar } from '@/components/publishing/calendar';

export const metadata: Metadata = { title: 'Calendar' };

export default function PublishCalendarPage() {
  return <PublishCalendar />;
}
