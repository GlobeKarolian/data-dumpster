import type { LucideIcon } from 'lucide-react';
import {
  Bell, Building2, Cpu, LayoutDashboard, LayoutGrid,
  MessageSquare, Radio, Sparkles, Tag, Link2, Trophy, FileText, FileSpreadsheet, Waypoints, Users,
} from 'lucide-react';
import { PLATFORM_COLORS, PLATFORM_LABELS, type Platform } from '@/lib/types';

/** Platforms that get their own overview screen, in the order newsrooms use them. */
export const NAV_PLATFORMS: Platform[] = [
  'facebook', 'instagram', 'threads', 'twitter', 'youtube', 'tiktok', 'bluesky',
];

export interface NavItem {
  href: string;
  label: string;
  icon?: LucideIcon;
  /** Platform rows carry a brand dot instead of an icon. */
  dotColor?: string;
  /** Match child routes as active, e.g. /settings/models under /settings. */
  matchPrefix?: boolean;
}

export interface NavSection {
  id: string;
  label: string | null;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'social',
    label: 'Social Analytics',
    items: [
      { href: '/cross-channel', label: 'Cross-Channel', icon: LayoutGrid },
      ...NAV_PLATFORMS.map((p) => ({
        href: '/' + p,
        label: PLATFORM_LABELS[p],
        dotColor: PLATFORM_COLORS[p],
      })),
      { href: '/leaderboard', label: 'Leaderboards', icon: Trophy },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    items: [
      { href: '/stories', label: 'Story Cloud', icon: Waypoints },
      { href: '/posts', label: 'Social Posts', icon: FileText },
      { href: '/content', label: 'Content Analysis', icon: Sparkles },
      { href: '/post-tags', label: 'Post Tags', icon: Tag },
      { href: '/posted-urls', label: 'Posted URLs', icon: Link2 },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      { href: '/reports', label: 'Weekly Report', icon: FileSpreadsheet, matchPrefix: true },
      { href: '/briefs', label: 'Briefs', icon: Sparkles, matchPrefix: true },
      { href: '/ask', label: 'Ask', icon: MessageSquare },
      { href: '/alerts', label: 'Alerts', icon: Bell },
    ],
  },
  {
    id: 'dashboards',
    label: 'Dashboards',
    items: [{ href: '/dashboards', label: 'All Dashboards', icon: LayoutDashboard, matchPrefix: true }],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { href: '/settings/users', label: 'Users', icon: Users },
      { href: '/settings/models', label: 'Models', icon: Cpu },
      { href: '/settings/sources', label: 'Sources', icon: Radio },
      { href: '/settings/companies', label: 'Companies', icon: Building2 },
    ],
  },
];

/** Page titles keyed by route, used by the top bar and document metadata. */
export const ROUTE_TITLES: Record<string, string> = {
  '/cross-channel': 'Cross-Channel',
  '/leaderboard': 'Leaderboards',
  '/stories': 'Story Cloud',
  '/posts': 'Social Posts',
  '/content': 'Content Analysis',
  '/post-tags': 'Post Tags',
  '/posted-urls': 'Posted URLs',
  '/reports': 'Weekly Report',
  '/briefs': 'Briefs',
  '/ask': 'Ask',
  '/alerts': 'Alerts',
  '/dashboards': 'Dashboards',
  '/settings/users': 'Users and Invitations',
  '/settings/models': 'Model Connections',
  '/settings/sources': 'Sources',
  '/settings/companies': 'Companies and Landscapes',
};
