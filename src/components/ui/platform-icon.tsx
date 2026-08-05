import * as React from 'react';
import {
  SiBluesky,
  SiFacebook,
  SiInstagram,
  SiReddit,
  SiRss,
  SiThreads,
  SiTiktok,
  SiX,
  SiYoutube,
} from '@icons-pack/react-simple-icons';
import { PLATFORM_COLORS, PLATFORM_LABELS, type Platform } from '@/lib/types';
import { cn } from '@/lib/utils';

type BrandIcon = React.ComponentType<{
  className?: string;
  color?: string;
  size?: number;
  title?: string;
  'aria-hidden'?: boolean;
}>;

const ICONS: Partial<Record<Platform, BrandIcon>> = {
  facebook: SiFacebook,
  instagram: SiInstagram,
  twitter: SiX,
  youtube: SiYoutube,
  tiktok: SiTiktok,
  bluesky: SiBluesky,
  threads: SiThreads,
  reddit: SiReddit,
  rss: SiRss,
};

function LinkedInMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect width="24" height="24" rx="2.5" fill="currentColor" />
      <circle cx="6.8" cy="7" r="1.55" fill="white" />
      <path d="M5.45 9.5h2.7v8.8h-2.7zm4.3 0h2.58v1.2h.04c.36-.68 1.24-1.4 2.56-1.4 2.74 0 3.25 1.8 3.25 4.15v4.85h-2.7v-4.3c0-1.03-.02-2.35-1.43-2.35-1.44 0-1.66 1.12-1.66 2.27v4.38h-2.7z" fill="white" />
    </svg>
  );
}

export function PlatformIcon({
  platform,
  className,
  label = false,
}: {
  platform: Platform;
  className?: string;
  /** Icon-only controls can opt into an accessible platform name. */
  label?: boolean;
}) {
  const common = cn(
    'h-3.5 w-3.5 shrink-0',
    (platform === 'twitter' || platform === 'threads')
      && 'text-zinc-950 dark:text-zinc-50',
    className,
  );
  const accessibility = label
    ? { role: 'img' as const, 'aria-label': PLATFORM_LABELS[platform] }
    : { 'aria-hidden': true as const };

  if (platform === 'linkedin') {
    return (
      <span {...accessibility} className="inline-flex" style={{ color: PLATFORM_COLORS.linkedin }}>
        <LinkedInMark className={common} />
      </span>
    );
  }

  const Icon = ICONS[platform];
  if (!Icon) return null;
  const color = platform === 'twitter' || platform === 'threads'
    ? 'currentColor'
    : PLATFORM_COLORS[platform];
  return (
    <Icon
      {...accessibility}
      className={common}
      color={color}
      title={label ? PLATFORM_LABELS[platform] : ''}
    />
  );
}
