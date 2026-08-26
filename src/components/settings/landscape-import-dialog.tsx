'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  CircleAlert,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { PLATFORMS, type Platform } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge, PlatformBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const MAX_FILE_BYTES = 1_000_000;
const DIALOG_TITLE_ID = 'landscape-import-title';
const DIALOG_DESCRIPTION_ID = 'landscape-import-description';

const SIMPLE_TEMPLATE = [
  'company_name,company_url,is_focus,segment,color,facebook,instagram,threads,x,youtube,tiktok,bluesky,reddit,linkedin',
  '"The Boston Globe",https://www.bostonglobe.com,yes,metro daily,#C8102E,https://www.facebook.com/globe,https://www.instagram.com/bostonglobe,https://www.threads.com/@bostonglobe,https://x.com/BostonGlobe,https://www.youtube.com/@bostonglobe,https://www.tiktok.com/@bostonglobe,https://bsky.app/profile/bostonglobe.com,https://www.reddit.com/user/bostonglobe/,',
  'WBUR,https://www.wbur.org,no,public radio,#0D9488,https://www.facebook.com/WBUR90.9,https://www.instagram.com/wbur,,,https://www.youtube.com/@WBUR,https://www.tiktok.com/@wbur,https://bsky.app/profile/wbur.org,,',
].join('\r\n');

type ImportPhase = 'upload' | 'review' | 'success';
type IssueLevel = 'error' | 'warning';

interface ImportIssue {
  level: IssueLevel;
  message: string;
  code?: string;
  row?: number;
  field?: string;
}

interface PreviewProfile {
  platform: Platform | null;
  platformLabel: string;
  handle: string;
  profileUrl: string | null;
}

interface PreviewCompany {
  key: string;
  name: string;
  website: string | null;
  profiles: PreviewProfile[];
  existing: boolean;
  suggestedFocus: boolean;
  rows: number[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

interface ImportPreview {
  format: string | null;
  companies: PreviewCompany[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  companyCount: number;
  profileCount: number;
  newCompanyCount: number;
  reusedCompanyCount: number;
  suggestedFocusKey: string | null;
}

export interface LandscapeImportResult {
  landscape: {
    id: string | null;
    name: string;
    slug: string | null;
  };
  companiesCreated: number;
  companiesReused: number;
  profilesCreated: number;
  profilesReused: number;
  collectionQueued: number;
  warnings: string[];
  href: string | null;
}

export interface LandscapeImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: (result: LandscapeImportResult) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function booleanValue(record: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', 'yes', 'y', '1', 'existing', 'reused'].includes(normalized)) return true;
    }
  }
  return false;
}

function numberValue(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === 'number' ? item : Number(item))
    .filter((item) => Number.isFinite(item));
}

const PLATFORM_ALIASES: Record<string, Platform> = {
  facebook: 'facebook',
  fb: 'facebook',
  instagram: 'instagram',
  ig: 'instagram',
  twitter: 'twitter',
  x: 'twitter',
  'x/twitter': 'twitter',
  youtube: 'youtube',
  yt: 'youtube',
  tiktok: 'tiktok',
  'tik tok': 'tiktok',
  linkedin: 'linkedin',
  bluesky: 'bluesky',
  bsky: 'bluesky',
  threads: 'threads',
  reddit: 'reddit',
  rss: 'rss',
};

function toPlatform(value: unknown): Platform | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  const alias = PLATFORM_ALIASES[normalized];
  if (alias) return alias;
  return (PLATFORMS as readonly string[]).includes(normalized)
    ? normalized as Platform
    : null;
}

function issueFrom(value: unknown, level: IssueLevel): ImportIssue | null {
  if (typeof value === 'string' && value.trim()) {
    return { level, message: value.trim() };
  }
  if (!isRecord(value)) return null;
  const message = stringValue(value, ['message', 'error', 'detail', 'reason']);
  if (!message) return null;
  const rawLevel = stringValue(value, ['level', 'severity', 'type'])?.toLowerCase();
  const row = numberValue(value, ['row', 'rowNumber', 'line']);
  const resolvedLevel: IssueLevel = rawLevel === 'error' || rawLevel === 'critical'
    ? 'error'
    : rawLevel === 'warning' || rawLevel === 'warn'
      ? 'warning'
      : level;
  return {
    level: resolvedLevel,
    message,
    code: stringValue(value, ['code']) ?? undefined,
    row: row !== null && row > 0 ? row : undefined,
    field: stringValue(value, ['field', 'column', 'path']) ?? undefined,
  };
}

function issuesFrom(value: unknown, level: IssueLevel): ImportIssue[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values
    .map((item) => issueFrom(item, level))
    .filter((item): item is ImportIssue => item !== null);
}

function profileFrom(value: unknown, fallbackPlatform?: string): PreviewProfile | null {
  if (typeof value === 'string') {
    const platform = toPlatform(fallbackPlatform);
    return {
      platform,
      platformLabel: fallbackPlatform ?? 'Unknown',
      handle: value.trim(),
      profileUrl: /^https?:\/\//i.test(value.trim()) ? value.trim() : null,
    };
  }
  if (!isRecord(value)) return null;
  const rawPlatform = stringValue(value, ['platform', 'network', 'channel']) ?? fallbackPlatform ?? 'Unknown';
  const platform = toPlatform(rawPlatform);
  const handle = stringValue(value, [
    'handle',
    'normalizedHandle',
    'username',
    'input',
    'profileUrl',
    'profile_url',
    'url',
  ]);
  if (!handle) return null;
  return {
    platform,
    platformLabel: rawPlatform,
    handle,
    profileUrl: stringValue(value, ['profileUrl', 'profile_url', 'url'])
      ?? (/^https?:\/\//i.test(handle) ? handle : null),
  };
}

function profilesFrom(record: Record<string, unknown>): PreviewProfile[] {
  const source = record.profiles ?? record.channels ?? record.accounts ?? record.platforms;
  const profiles: PreviewProfile[] = [];

  if (Array.isArray(source)) {
    for (const item of source) {
      const profile = profileFrom(item);
      if (profile) profiles.push(profile);
    }
  } else if (isRecord(source)) {
    for (const [platform, raw] of Object.entries(source)) {
      if (Array.isArray(raw)) {
        for (const item of raw) {
          const profile = profileFrom(item, platform);
          if (profile) profiles.push(profile);
        }
      } else {
        const profile = profileFrom(raw, platform);
        if (profile) profiles.push(profile);
      }
    }
  }

  if (profiles.length === 0) {
    for (const platform of PLATFORMS) {
      const profile = profileFrom(record[platform], platform);
      if (profile) profiles.push(profile);
    }
  }

  return profiles;
}

function companyFrom(value: unknown, index: number): PreviewCompany | null {
  if (!isRecord(value)) return null;
  const key = stringValue(value, ['key', 'companyKey', 'company_key', 'rowKey', 'id'])
    ?? String(index + 1);
  const errors = [
    ...issuesFrom(value.errors, 'error'),
    ...issuesFrom(value.error, 'error'),
  ];
  const warnings = [
    ...issuesFrom(value.warnings, 'warning'),
    ...issuesFrom(value.warning, 'warning'),
  ];
  const name = stringValue(value, ['name', 'companyName', 'company_name', 'brand', 'outlet'])
    ?? 'Unnamed company';
  return {
    key,
    name,
    website: stringValue(value, ['website', 'companyUrl', 'company_url', 'url']),
    profiles: profilesFrom(value),
    existing: booleanValue(value, ['existing', 'reused', 'isExisting', 'is_existing'])
      || ['existing', 'reuse', 'reused'].includes(
        stringValue(value, ['status', 'action'])?.toLowerCase() ?? '',
      ),
    suggestedFocus: booleanValue(value, [
      'isFocus',
      'is_focus',
      'focus',
      'focusCompany',
      'focus_company',
    ]),
    rows: numberArray(value.rows),
    errors,
    warnings,
  };
}

function nestedPayload(payload: unknown, key: string): Record<string, unknown> {
  if (!isRecord(payload)) return {};
  return isRecord(payload[key]) ? payload[key] as Record<string, unknown> : payload;
}

function normalizePreview(payload: unknown): ImportPreview {
  const root = nestedPayload(payload, 'preview');
  const source = root.companies ?? root.rows ?? root.items;
  const companies = (Array.isArray(source) ? source : [])
    .map(companyFrom)
    .filter((company): company is PreviewCompany => company !== null);

  const rootIssues = issuesFrom(root.issues, 'warning');
  const parsedErrors = [
    ...issuesFrom(root.errors, 'error'),
    ...rootIssues.filter((issue) => issue.level === 'error'),
  ];
  const parsedWarnings = [
    ...issuesFrom(root.warnings, 'warning'),
    ...rootIssues.filter((issue) => issue.level === 'warning'),
  ];
  const assignRowIssue = (issue: ImportIssue, level: IssueLevel): boolean => {
    if (issue.row === undefined) return false;
    const company = companies.find((item) => item.rows.includes(issue.row!));
    if (!company) return false;
    (level === 'error' ? company.errors : company.warnings).push(issue);
    return true;
  };
  const errors = parsedErrors.filter((issue) => !assignRowIssue(issue, 'error'));
  const warnings = parsedWarnings.filter((issue) => !assignRowIssue(issue, 'warning'));
  const summary = isRecord(root.summary)
    ? root.summary
    : isRecord(root.counts)
      ? root.counts
      : {};
  const rowErrors = companies.flatMap((company) => company.errors);
  const rowWarnings = companies.flatMap((company) => company.warnings);
  const declaredErrors = numberValue(summary, ['errors', 'errorCount', 'error_count'])
    ?? numberValue(root, ['errorCount', 'error_count'])
    ?? 0;
  const declaredWarnings = numberValue(summary, ['warnings', 'warningCount', 'warning_count'])
    ?? numberValue(root, ['warningCount', 'warning_count'])
    ?? 0;

  if (declaredErrors > errors.length + rowErrors.length) {
    errors.push({
      level: 'error',
      message: declaredErrors + ' import errors were found. Review the uploaded rows before continuing.',
    });
  }
  if (declaredWarnings > warnings.length + rowWarnings.length) {
    warnings.push({
      level: 'warning',
      message: declaredWarnings + ' import warnings were found.',
    });
  }
  if (companies.length === 0 && errors.length === 0) {
    errors.push({
      level: 'error',
      message: 'No companies were found in this CSV.',
    });
  }

  const suggested = companies.filter((company) => company.suggestedFocus);
  const declaredSuggestedFocus = stringValue(root, [
    'suggestedFocusCompanyKey',
    'suggested_focus_company_key',
    'focusCompanyKey',
  ]);
  const companyCount = numberValue(summary, ['companies', 'companyCount', 'company_count'])
    ?? companies.length;
  const profileCount = numberValue(summary, ['profiles', 'channels', 'profileCount', 'profile_count'])
    ?? companies.reduce((total, company) => total + company.profiles.length, 0);
  const reusedCompanyCount = numberValue(summary, [
    'companiesReused',
    'reusedCompanies',
    'existingCompanies',
    'reused_company_count',
  ]) ?? companies.filter((company) => company.existing).length;
  const newCompanyCount = numberValue(summary, [
    'companiesCreated',
    'newCompanies',
    'createdCompanies',
    'new_company_count',
  ]) ?? Math.max(0, companyCount - reusedCompanyCount);

  return {
    format: stringValue(root, ['format', 'detectedFormat', 'detected_format']),
    companies,
    errors,
    warnings,
    companyCount,
    profileCount,
    newCompanyCount,
    reusedCompanyCount,
    suggestedFocusKey: declaredSuggestedFocus ?? (suggested.length === 1 ? suggested[0].key : null),
  };
}

function safeInternalHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  return href.startsWith('/') && !href.startsWith('//') ? href : null;
}

function normalizeImportResult(payload: unknown, fallbackName: string): LandscapeImportResult {
  const root = nestedPayload(payload, 'result');
  const landscape = isRecord(root.landscape) ? root.landscape : {};
  const summary = isRecord(root.summary)
    ? root.summary
    : isRecord(root.counts)
      ? root.counts
      : root;
  const id = stringValue(landscape, ['id', 'landscapeId', 'landscape_id'])
    ?? stringValue(root, ['landscapeId', 'landscape_id']);
  const name = stringValue(landscape, ['name', 'landscapeName', 'landscape_name'])
    ?? stringValue(root, ['landscapeName', 'landscape_name'])
    ?? fallbackName;
  const slug = stringValue(landscape, ['slug']) ?? stringValue(root, ['landscapeSlug', 'landscape_slug']);
  const explicitHref = safeInternalHref(
    landscape.href ?? landscape.url ?? root.href ?? root.landscapeHref ?? root.landscape_url,
  );
  const warnings = [
    ...issuesFrom(root.warnings, 'warning'),
    ...issuesFrom(landscape.warnings, 'warning'),
  ].map((issue) => issue.message);

  return {
    landscape: { id, name, slug },
    companiesCreated: numberValue(summary, [
      'companiesCreated',
      'createdCompanies',
      'newCompanies',
      'new_companies',
    ]) ?? 0,
    companiesReused: numberValue(summary, [
      'companiesReused',
      'reusedCompanies',
      'existingCompanies',
      'reused_companies',
    ]) ?? 0,
    profilesCreated: numberValue(summary, [
      'profilesCreated',
      'createdProfiles',
      'channelsCreated',
      'newChannels',
      'accountsAdded',
      'new_profiles',
    ]) ?? 0,
    profilesReused: numberValue(summary, [
      'profilesReused',
      'reusedProfiles',
      'channelsReused',
      'existingChannels',
      'accountsReused',
      'reused_profiles',
    ]) ?? 0,
    collectionQueued: numberValue(summary, [
      'collectionQueued',
      'profilesQueued',
      'channelsQueued',
    ]) ?? 0,
    warnings,
    href: explicitHref ?? (id ? '/cross-channel?landscape=' + encodeURIComponent(id) : null),
  };
}

async function readApiResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (response.ok) return payload;

  if (isRecord(payload)) {
    const message = stringValue(payload, ['error', 'message', 'detail']);
    const fields = Array.isArray(payload.fields)
      ? payload.fields
        .filter(isRecord)
        .map((field) => stringValue(field, ['message']))
        .filter((item): item is string => item !== null)
      : [];
    const importIssues = [
      ...issuesFrom(payload.errors, 'error'),
      ...issuesFrom(payload.warnings, 'warning'),
    ].map((issue) => issuePrefix(issue) + issue.message);
    throw new Error(
      [message, ...fields, ...importIssues].filter(Boolean).join(' ')
      || 'The import request failed.',
    );
  }
  throw new Error(typeof payload === 'string' && payload.trim()
    ? payload.trim()
    : 'The import request failed with status ' + response.status + '.');
}

function suggestionFromFilename(filename: string): string {
  return filename
    .replace(/\.csv$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatLabel(format: string | null): string {
  if (!format) return 'CSV';
  const normalized = format.toLowerCase();
  if (normalized.includes('rival')) return 'Rival IQ export';
  if (normalized.includes('long')) return 'Long profile list';
  if (normalized.includes('wide')) return 'Company-per-row CSV';
  return format;
}

function issuePrefix(issue: ImportIssue): string {
  const parts: string[] = [];
  if (issue.row !== undefined) parts.push('Row ' + issue.row);
  if (issue.field) {
    parts.push(issue.field
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/^./, (character) => character.toUpperCase()));
  }
  return parts.length > 0 ? parts.join(', ') + ': ' : '';
}

function SummaryBox({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="pb-num text-lg font-semibold text-zinc-950 dark:text-zinc-50">
        {value.toLocaleString('en-US')}
      </p>
      <p className="text-[11px] text-zinc-500 dark:text-zinc-500">{label}</p>
    </div>
  );
}

function Issues({
  errors,
  warnings,
}: {
  errors: ImportIssue[];
  warnings: ImportIssue[];
}) {
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      {errors.length > 0 ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-400"
        >
          <p className="mb-1.5 flex items-center gap-1.5 font-medium">
            <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {errors.length + (errors.length === 1 ? ' error needs' : ' errors need') + ' attention'}
          </p>
          <ul className="space-y-1 pl-5">
            {errors.map((issue, index) => (
              <li key={index} className="list-disc">
                {issuePrefix(issue) + issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-400">
          <p className="mb-1.5 flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {warnings.length + (warnings.length === 1 ? ' warning' : ' warnings')}
          </p>
          <ul className="space-y-1 pl-5">
            {warnings.map((issue, index) => (
              <li key={index} className="list-disc">
                {issuePrefix(issue) + issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function LandscapeImportDialog({
  open,
  onOpenChange,
  onImported,
}: LandscapeImportDialogProps) {
  const router = useRouter();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const requestRef = React.useRef<AbortController | null>(null);
  const previewedLandscapeNameRef = React.useRef('');
  const [phase, setPhase] = React.useState<ImportPhase>('upload');
  const [fileName, setFileName] = React.useState('');
  const [csv, setCsv] = React.useState('');
  const [landscapeName, setLandscapeName] = React.useState('');
  const [focusCompanyKey, setFocusCompanyKey] = React.useState('');
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [success, setSuccess] = React.useState<LandscapeImportResult | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => () => {
    requestRef.current?.abort();
  }, []);

  const reset = React.useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    previewedLandscapeNameRef.current = '';
    setPhase('upload');
    setFileName('');
    setCsv('');
    setLandscapeName('');
    setFocusCompanyKey('');
    setPreview(null);
    setSuccess(null);
    setDragging(false);
    setBusy(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const close = React.useCallback(() => {
    if (busy) return;
    reset();
    onOpenChange(false);
  }, [busy, onOpenChange, reset]);

  const previewCsv = React.useCallback(async (
    contents: string,
    options?: { landscapeName?: string; preserveFocus?: boolean },
  ) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/landscapes/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'preview',
          csv: contents,
          ...(options?.landscapeName ? { landscapeName: options.landscapeName } : {}),
        }),
        signal: controller.signal,
      });
      const payload = await readApiResponse(response);
      const normalized = normalizePreview(payload);
      previewedLandscapeNameRef.current = options?.landscapeName ?? '';
      setPreview(normalized);
      setFocusCompanyKey((current) => (
        options?.preserveFocus && normalized.companies.some((company) => company.key === current)
          ? current
          : normalized.suggestedFocusKey ?? ''
      ));
      setPhase('review');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'The CSV could not be previewed.');
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  }, []);

  const readFile = React.useCallback(async (file: File) => {
    setError(null);
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Choose a CSV file.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is larger than 1 MB. Split it into smaller landscapes before importing.');
      return;
    }
    try {
      const contents = await file.text();
      if (!contents.trim()) {
        setError('That CSV is empty.');
        return;
      }
      setFileName(file.name);
      setCsv(contents);
      const suggestedName = suggestionFromFilename(file.name);
      setLandscapeName(suggestedName);
      await previewCsv(contents, { landscapeName: suggestedName });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The CSV could not be read.');
    }
  }, [previewCsv]);

  const replaceFile = () => {
    requestRef.current?.abort();
    previewedLandscapeNameRef.current = '';
    setPhase('upload');
    setFileName('');
    setCsv('');
    setFocusCompanyKey('');
    setPreview(null);
    setSuccess(null);
    setBusy(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  React.useEffect(() => {
    const proposedName = landscapeName.trim();
    if (
      phase !== 'review'
      || !csv
      || !proposedName
      || proposedName === previewedLandscapeNameRef.current
    ) return;

    const timer = window.setTimeout(() => {
      void previewCsv(csv, { landscapeName: proposedName, preserveFocus: true });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [csv, landscapeName, phase, previewCsv]);

  const downloadTemplate = () => {
    const blob = new Blob(['\uFEFF' + SIMPLE_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'landscape-import-template.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const commit = async () => {
    if (!preview || !csv || !landscapeName.trim()) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/landscapes/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          csv,
          landscapeName: landscapeName.trim(),
          // Absent means a focusless landscape: a market watched from outside.
          focusCompanyKey: focusCompanyKey || undefined,
        }),
        signal: controller.signal,
      });
      const payload = await readApiResponse(response);
      const result = normalizeImportResult(payload, landscapeName.trim());
      setSuccess(result);
      setPhase('success');
      onImported?.(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'The landscape could not be created.');
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  };

  const rowErrors = preview?.companies.flatMap((company) => company.errors) ?? [];
  const rowWarnings = preview?.companies.flatMap((company) => company.warnings) ?? [];
  const allErrors = [...(preview?.errors ?? []), ...rowErrors];
  const reviewWarnings = preview?.warnings ?? [];
  const allWarnings = [...reviewWarnings, ...rowWarnings];
  const canImport = Boolean(
    preview
    && csv
    && landscapeName.trim()
    && allErrors.length === 0
    && !busy,
  );

  const dialogDescription = phase === 'upload'
    ? 'Upload a CSV containing the companies and social profiles for a new landscape.'
    : phase === 'review'
      ? 'Review every company and profile, name the landscape, and optionally choose a focus company.'
      : 'The landscape and its social profiles were created.';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      labelledBy={DIALOG_TITLE_ID}
      describedBy={DIALOG_DESCRIPTION_ID}
      className="max-w-6xl"
    >
      <div className="flex items-start gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <FileSpreadsheet className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={DIALOG_TITLE_ID} className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
            Import a landscape
          </h2>
          <p id={DIALOG_DESCRIPTION_ID} className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {dialogDescription}
          </p>
        </div>
        <ol className="hidden items-center gap-1.5 sm:flex" aria-label="Import progress">
          {(['upload', 'review', 'success'] as const).map((step, index) => {
            const stepIndex = ['upload', 'review', 'success'].indexOf(step);
            const currentIndex = ['upload', 'review', 'success'].indexOf(phase);
            const complete = stepIndex < currentIndex;
            const current = step === phase;
            return (
              <li
                key={step}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium',
                  current && 'bg-accent-600/10 text-accent-700 dark:text-accent-400',
                  complete && 'text-emerald-700 dark:text-emerald-400',
                  !current && !complete && 'text-zinc-400 dark:text-zinc-600',
                )}
              >
                <span
                  className={cn(
                    'grid h-4 w-4 place-items-center rounded-full border text-[9px]',
                    current && 'border-accent-600',
                    complete && 'border-emerald-600 bg-emerald-600 text-white',
                    !current && !complete && 'border-zinc-300 dark:border-zinc-700',
                  )}
                >
                  {complete ? <Check className="h-2.5 w-2.5" aria-hidden /> : index + 1}
                </span>
                {step === 'upload' ? 'Upload' : step === 'review' ? 'Review' : 'Created'}
              </li>
            );
          })}
        </ol>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Close landscape import"
          disabled={busy}
          onClick={close}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {phase === 'upload' ? (
        <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void readFile(file);
                }}
              />
              <div
                role="button"
                tabIndex={busy ? -1 : 0}
                data-dialog-initial-focus
                aria-disabled={busy}
                aria-label="Choose a landscape CSV or drop it here"
                className={cn(
                  'flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center outline-none transition-colors',
                  'focus:border-accent-600 focus:ring-2 focus:ring-accent-600/15',
                  'dark:focus:border-accent-500 dark:focus:ring-accent-500/15',
                  dragging
                    ? 'border-accent-600 bg-accent-600/5 dark:border-accent-500 dark:bg-accent-600/10'
                    : 'border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100/60 dark:border-zinc-700 dark:bg-zinc-900/40 dark:hover:border-zinc-600 dark:hover:bg-zinc-900',
                  busy && 'cursor-wait opacity-70',
                )}
                onClick={() => {
                  if (!busy) fileInputRef.current?.click();
                }}
                onKeyDown={(event) => {
                  if (busy || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  fileInputRef.current?.click();
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!busy) setDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!busy) setDragging(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDragging(false);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  if (busy) return;
                  const file = event.dataTransfer.files?.[0];
                  if (file) void readFile(file);
                }}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin text-accent-600" strokeWidth={1.5} aria-hidden />
                    <p className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Reading {fileName || 'CSV'}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">Checking every company and profile.</p>
                  </>
                ) : (
                  <>
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-zinc-500 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-400 dark:ring-zinc-800">
                      <Upload className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                    </span>
                    <p className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Drop a CSV here or choose a file
                    </p>
                    <p className="mt-1 max-w-md text-xs leading-relaxed text-zinc-500">
                      One company per row, with profile URLs or handles in platform columns. Rival IQ
                      company exports are accepted directly.
                    </p>
                    <span className="mt-4 inline-flex h-7 items-center rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                      Choose CSV
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Start from a template</p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                  The simple template includes company details, a focus-company flag, and one column
                  for every supported social network.
                </p>
                <Button type="button" size="sm" className="mt-3" onClick={downloadTemplate}>
                  <Download className="h-3 w-3" aria-hidden />
                  Download template
                </Button>
              </div>
              <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Before anything is saved</p>
                <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-zinc-500">
                  <li>Every company and profile appears in a review table.</li>
                  <li>Invalid rows block creation instead of being silently skipped.</li>
                  <li>Existing companies and profiles are reused.</li>
                  <li>Importing does not start ingestion or spend vendor credits.</li>
                </ul>
              </div>
              <p className="px-1 text-[11px] text-zinc-500">CSV files up to 1 MB. Maximum 100 companies per landscape.</p>
            </div>
          </div>
          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-400"
            >
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {phase === 'review' && preview ? (
        <>
          <div className="max-h-[calc(100dvh-12rem)] space-y-4 overflow-y-auto p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{fileName}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {'Detected as ' + formatLabel(preview.format) + '. No vendor calls were made.'}
                </p>
              </div>
              <Button type="button" size="sm" disabled={busy} onClick={replaceFile}>
                Replace file
              </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-4">
              <SummaryBox value={preview.companyCount} label="Companies" />
              <SummaryBox value={preview.profileCount} label="Social profiles" />
              <SummaryBox value={preview.newCompanyCount} label="New companies" />
              <SummaryBox value={preview.reusedCompanyCount} label="Existing companies reused" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Landscape name"
                htmlFor="landscape-import-name"
                hint="This name appears in the landscape switcher and every report."
              >
                <Input
                  id="landscape-import-name"
                  value={landscapeName}
                  maxLength={120}
                  required
                  disabled={busy}
                  onChange={(event) => setLandscapeName(event.target.value)}
                />
              </Field>
              <Field
                label="Focus company"
                htmlFor="landscape-import-focus"
                hint="Optional. Comparisons are written from this company’s point of view; leave it unset to watch the market from outside."
              >
                <Select
                  id="landscape-import-focus"
                  value={focusCompanyKey}
                  disabled={busy}
                  placeholder="No focus company"
                  options={[
                    { value: '', label: 'No focus company' },
                    ...preview.companies.map((company) => ({
                      value: company.key,
                      label: company.name,
                    })),
                  ]}
                  onChange={(event) => setFocusCompanyKey(event.target.value)}
                />
              </Field>
            </div>

            <Issues errors={preview.errors} warnings={reviewWarnings} />

            <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
                    <tr>
                      <th scope="col" className="w-8 px-3 py-2">
                        <span className="sr-only">Focus company</span>
                      </th>
                      <th scope="col" className="px-3 py-2">Company</th>
                      <th scope="col" className="px-3 py-2">Website</th>
                      <th scope="col" className="px-3 py-2">Profiles</th>
                      <th scope="col" className="w-24 px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                    {preview.companies.map((company) => {
                      const selected = focusCompanyKey === company.key;
                      const status = company.errors.length > 0
                        ? 'error'
                        : company.warnings.length > 0
                          ? 'warning'
                          : 'ready';
                      return (
                        <tr key={company.key} className={cn(selected && 'bg-accent-600/[0.035]')}>
                          <td className="px-3 py-3 align-top">
                            <input
                              type="radio"
                              name="landscape-import-focus-row"
                              value={company.key}
                              checked={selected}
                              disabled={busy}
                              aria-label={'Use ' + company.name + ' as the focus company'}
                              onChange={() => setFocusCompanyKey(company.key)}
                              className="h-3.5 w-3.5 accent-accent-600"
                            />
                          </td>
                          <td className="max-w-56 px-3 py-3 align-top">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                                {company.name}
                              </span>
                              <Badge tone={company.existing ? 'outline' : 'neutral'}>
                                {company.existing ? 'Existing' : 'New'}
                              </Badge>
                            </div>
                            {company.errors.map((issue, index) => (
                              <p key={'error-' + index} className="mt-1 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
                                {issuePrefix(issue) + issue.message}
                              </p>
                            ))}
                            {company.warnings.map((issue, index) => (
                              <p key={'warning-' + index} className="mt-1 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                                {issuePrefix(issue) + issue.message}
                              </p>
                            ))}
                          </td>
                          <td className="max-w-56 px-3 py-3 align-top text-zinc-500">
                            <span className="block truncate" title={company.website ?? undefined}>
                              {company.website ?? '--'}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-top">
                            {company.profiles.length > 0 ? (
                              <div className="flex flex-wrap gap-x-4 gap-y-2">
                                {company.profiles.map((profile, index) => (
                                  <span key={profile.platformLabel + '-' + profile.handle + '-' + index} className="inline-flex min-w-0 items-center gap-1.5">
                                    {profile.platform ? (
                                      <PlatformBadge platform={profile.platform} showLabel={false} />
                                    ) : (
                                      <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
                                    )}
                                    <span
                                      className="max-w-44 truncate text-[11px] text-zinc-600 dark:text-zinc-400"
                                      title={profile.handle}
                                    >
                                      {profile.handle}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[11px] text-zinc-400">No profiles</span>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <Badge tone={status === 'error' ? 'critical' : status === 'warning' ? 'warning' : 'positive'}>
                              {status === 'error' ? 'Fix row' : status === 'warning' ? 'Review' : 'Ready'}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-400"
              >
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <div className="text-[11px] text-zinc-500">
              {allErrors.length > 0 ? (
                <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                  <CircleAlert className="h-3.5 w-3.5" aria-hidden />
                  Fix every error in the CSV before importing.
                </span>
              ) : !landscapeName.trim() ? (
                'Enter a landscape name to continue.'
              ) : allWarnings.length > 0 ? (
                allWarnings.length + (allWarnings.length === 1 ? ' warning will' : ' warnings will') + ' be carried into the import receipt.'
              ) : (
                'Ready to create. Every profile will be queued for collection automatically.'
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={close}>Cancel</Button>
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={!canImport}
                onClick={() => void commit()}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Upload className="h-3 w-3" aria-hidden />}
                {busy
                  ? 'Creating landscape'
                  : 'Create landscape with ' + preview.companyCount + (preview.companyCount === 1 ? ' company' : ' companies')}
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {phase === 'success' && success ? (
        <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-5">
          <div className="mx-auto max-w-2xl">
            <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/25">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
                <Check className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-emerald-950 dark:text-emerald-200">
                  {success.landscape.name + ' was created'}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-emerald-800 dark:text-emerald-400">
                  The landscape and profile connections were saved, and complete-window collection
                  was queued for every profile. Measured totals remain visible as partial while the missing history is collected; WoW comparisons stay withheld until both windows are complete.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-5">
              <SummaryBox value={success.companiesCreated} label="Companies created" />
              <SummaryBox value={success.companiesReused} label="Companies reused" />
              <SummaryBox value={success.profilesCreated} label="Profiles added" />
              <SummaryBox value={success.profilesReused} label="Profiles already present" />
              <SummaryBox value={success.collectionQueued} label="Profiles queued" />
            </div>

            {success.warnings.length > 0 ? (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-400">
                <p className="mb-1.5 flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  Import notes
                </p>
                <ul className="space-y-1 pl-5">
                  {success.warnings.map((warning, index) => (
                    <li key={index} className="list-disc">{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" onClick={close}>Close</Button>
              {success.href ? (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    const href = success.href;
                    if (!href) return;
                    reset();
                    onOpenChange(false);
                    router.push(href);
                  }}
                >
                  Open landscape
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
