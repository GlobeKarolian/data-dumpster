import { redirect } from 'next/navigation';

/** RSS auto-post is switched off for now (Oct 2026); the settings live on in code. */
export default function AutopilotPage() {
  redirect('/publish');
}
