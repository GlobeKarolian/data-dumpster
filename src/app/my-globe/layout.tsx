import type { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL('https://pressbox-kappa.vercel.app'),
  title: { absolute: 'My Globe — Interactive concept' },
  description:
    'A clickable concept that turns Boston Globe newsletters into living, useful member hubs.',
  robots: { index: false, follow: false },
};

export default function MyGlobeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
