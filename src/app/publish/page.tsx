import type { Metadata } from 'next';
import { QueueBoard } from '@/components/publishing/queue-board';

export const metadata: Metadata = { title: 'Queue' };

export default function PublishQueuePage() {
  return <QueueBoard />;
}
