import type { LucideIcon } from 'lucide-react';
import {
  Bell, Building2, CircleDollarSign, Cpu, LayoutDashboard, LayoutGrid,
  MessageSquare, MonitorUp, Radio, SlidersHorizontal, Sparkles, Tag, Link2, Trophy, FileText, FileSpreadsheet, Waypoints, Users,
  Vote, UsersRound,
} from 'lucide-react';
import { PLATFORM_LABELS, type Platform } from '@/lib/types';

/** Platforms that get their own overview screen, in the order newsrooms use them. */
export const NAV_PLATFORMS: Platform[] = [
  'facebook', 'instagram', 'linkedin', 'threads', 'twitter', 'youtube', 'tiktok', 'bluesky', 'reddit', 'truth_social',
];

export interface NavItem {
  href: string;
  label: string;
  icon?: LucideIcon;
  /** Platform rows carry their recognizable network mark. */
  platform?: Platform;
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
      { href: '/today', label: 'Today', icon: Sparkles },
      { href: '/cross-channel', label: 'Cross-Channel', icon: LayoutGrid },
      ...NAV_PLATFORMS.map((p) => ({
        href: '/' + p,
        label: PLATFORM_LABELS[p],
        platform: p,
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
      { href: '/post-tags', label: 'Post Tags', icon: Tag },
      { href: '/posted-urls', label: 'Posted URLs', icon: Link2 },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      { href: '/elections', label: 'Election Center', icon: Vote, matchPrefix: true },
      { href: '/groups', label: 'Group View', icon: UsersRound, matchPrefix: true },
      { href: '/reports', label: 'Weekly Report', icon: FileSpreadsheet, matchPrefix: true },
      { href: '/briefs', label: 'Briefs', icon: Sparkles, matchPrefix: true },
      { href: '/ask', label: 'Ask', icon: MessageSquare },
      { href: '/alerts', label: 'Alerts', icon: Bell },
    ],
  },
  {
    id: 'dashboards',
    label: 'Dashboards',
    items: [
      { href: '/dashboards', label: 'All Dashboards', icon: LayoutDashboard, matchPrefix: true },
      { href: '/newsroom', label: 'Newsroom Screen', icon: MonitorUp },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { href: '/settings/users', label: 'Users', icon: Users },
      { href: '/settings/models', label: 'Models', icon: Cpu },
      { href: '/settings/sources', label: 'Social Profiles', icon: Radio },
      { href: '/settings/companies', label: 'Companies', icon: Building2 },
      { href: '/settings/costs', label: 'Costs', icon: CircleDollarSign },
      { href: '/settings/operations', label: 'Operations', icon: SlidersHorizontal },
    ],
  },
];

/** Page titles keyed by route, used by the top bar and document metadata. */
export const ROUTE_TITLES: Record<string, string> = {
  '/cross-channel': 'Cross-Channel',
  '/leaderboard': 'Leaderboards',
  '/stories': 'Story Cloud',
  '/posts': 'Social Posts',
  '/post-tags': 'Post Tags',
  '/posted-urls': 'Posted URLs',
  '/reports': 'Weekly Report',
  '/briefs': 'Briefs',
  '/ask': 'Ask',
  '/alerts': 'Alerts',
  '/dashboards': 'Dashboards',
  '/newsroom': 'Newsroom Screen',
  '/elections': 'Election Center',
  '/groups': 'Group View',
  '/elections/2028': 'Election Tracker · 2028 Preview',
  '/settings/users': 'Users and Access',
  '/settings/models': 'Model Connections',
  '/settings/sources': 'Social Profiles',
  '/settings/companies': 'Companies and Social Profiles',
  '/settings/costs': 'Costs',
  '/settings/operations': 'Operations',
  '/today': 'Today',
};
