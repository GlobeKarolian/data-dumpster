import { redirect } from 'next/navigation';

/** The first prototype lived here; keep old bookmarks working. */
export default function OldSettingsPage() {
  redirect('/publish/accounts');
}
