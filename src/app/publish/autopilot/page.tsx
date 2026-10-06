import type { Metadata } from 'next';
import { PublishingSettings } from '@/components/publishing/settings';

export const metadata: Metadata = { title: 'Autopilot' };

export default function PublishAutopilotPage() {
  return <PublishingSettings section="feeds" />;
}
