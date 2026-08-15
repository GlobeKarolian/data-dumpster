import type { Metadata } from 'next';
import { ElectionTrackerPreview } from '@/components/elections/election-tracker-preview';

export const metadata: Metadata = { title: 'Election Tracker — 2028 Preview' };

export default function ElectionTracker2028Page() {
  return <ElectionTrackerPreview />;
}
