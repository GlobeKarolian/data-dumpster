import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'], display: 'swap' });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: 'Data Dumpster',
    template: '%s · Data Dumpster',
  },
  description:
    'Competitive social intelligence for newsrooms. Every metric defined, every AI claim auditable, every model your own.',
  applicationName: 'Data Dumpster',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geistSans.variable + ' ' + geistMono.variable + ' h-full'}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
