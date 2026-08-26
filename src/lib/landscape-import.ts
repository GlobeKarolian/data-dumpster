import { getAdapter, hasAdapter } from '@/lib/adapters/registry';
import type { Platform } from '@/lib/types';
import { slugify } from '@/lib/utils';

export const LANDSCAPE_IMPORT_MAX_BYTES = 1_000_000;
export const LANDSCAPE_IMPORT_MAX_COMPANIES = 100;
export const LANDSCAPE_IMPORT_MAX_ACCOUNTS = 1000;

export const LANDSCAPE_IMPORT_PLATFORMS = [
  'facebook',
  'instagram',
  'twitter',
  'youtube',
  'tiktok',
  'threads',
  'bluesky',
  'linkedin',
  'reddit',
] as const satisfies readonly Platform[];

export type LandscapeImportPlatform = (typeof LANDSCAPE_IMPORT_PLATFORMS)[number];
export type LandscapeImportFormat = 'long' | 'wide';

const YOUTUBE_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

export function isCaseSensitiveLandscapeImportIdentity(
  platform: LandscapeImportPlatform,
  handle: string,
): boolean {
  return platform === 'youtube' && YOUTUBE_CHANNEL_ID_RE.test(handle);
}

export function landscapeImportIdentityHandle(
  platform: LandscapeImportPlatform,
  handle: string,
): string {
  return isCaseSensitiveLandscapeImportIdentity(platform, handle)
    ? handle
    : handle.toLowerCase();
}

export interface LandscapeImportIssue {
  row: number;
  column: string | null;
  code: string;
  message: string;
}

export interface LandscapeImportAccount {
  platform: LandscapeImportPlatform;
  input: string;
  handle: string;
  profileUrl: string | null;
  row: number;
  column: string;
}

export interface LandscapeImportCompany {
  /** Stable key returned to the client and accepted as focusCompanyKey. */
  key: string;
  name: string;
  slug: string;
  website: string | null;
  segment: string | null;
  color: string | null;
  focus: boolean;
  rows: number[];
  accounts: LandscapeImportAccount[];
}

export interface LandscapeImportPreview {
  format: LandscapeImportFormat | null;
  companies: LandscapeImportCompany[];
  accounts: LandscapeImportAccount[];
  errors: LandscapeImportIssue[];
  warnings: LandscapeImportIssue[];
  suggestedFocusCompanyKey: string | null;
  counts: {
    companies: number;
    accounts: number;
    errors: number;
    warnings: number;
  };
}

export type LandscapeImportEntityAction = 'create' | 'reuse' | 'conflict';

export interface LandscapeImportAccountPlan extends LandscapeImportAccount {
  action: LandscapeImportEntityAction;
  existingChannelId: string | null;
  existingCompanyId: string | null;
  existingCompanyName: string | null;
}

export interface LandscapeImportCompanyPlan
  extends Omit<LandscapeImportCompany, 'accounts'> {
  action: Exclude<LandscapeImportEntityAction, 'conflict'>;
  existingCompanyId: string | null;
  existingName: string | null;
  accounts: LandscapeImportAccountPlan[];
}

export interface LandscapeImportPlan
  extends Omit<LandscapeImportPreview, 'companies' | 'accounts'> {
  companies: LandscapeImportCompanyPlan[];
  accounts: LandscapeImportAccountPlan[];
  canImport: boolean;
  landscape: {
    name: string;
    slug: string;
    action: 'create' | 'conflict';
    existingLandscapeId: string | null;
    existingFocusCompanyId: string | null;
  } | null;
}

export interface LandscapeImportResult {
  landscape: {
    id: string;
    name: string;
    slug: string;
    created: boolean;
    /** Null for a focusless landscape: a market watched from outside. */
    focusCompanyId: string | null;
  };
  counts: {
    companiesCreated: number;
    companiesReused: number;
    accountsAdded: number;
    accountsReused: number;
    membersAdded: number;
    membersTotal: number;
    collectionQueued: number;
  };
  warnings: LandscapeImportIssue[];
}

interface ParsedCsv {
  rows: string[][];
  error: LandscapeImportIssue | null;
}

const COMPANY_HEADERS = new Set([
  'company',
  'company_name',
  'name',
  'brand',
  'brand_name',
  'outlet',
  'publisher',
  'organization',
  'organisation',
]);

const WEBSITE_HEADERS = new Set([
  'website',
  'company_website',
  'company_url',
  'site',
  'homepage',
  'domain',
]);

const FOCUS_HEADERS = new Set([
  'focus',
  'is_focus',
  'focus_company',
  'primary',
  'is_primary',
  'your_company',
]);

const SEGMENT_HEADERS = new Set(['segment', 'category', 'peer_group', 'market']);
const COLOR_HEADERS = new Set(['color', 'chart_color', 'hex_color']);
const PLATFORM_HEADERS = new Set(['platform', 'network', 'social_network', 'channel']);
const ACCOUNT_HEADERS = new Set([
  'account',
  'profile',
  'profile_url',
  'account_url',
  'handle',
  'username',
  'url',
]);

const PLATFORM_ALIASES: Record<string, LandscapeImportPlatform> = {
  facebook: 'facebook',
  fb: 'facebook',
  instagram: 'instagram',
  ig: 'instagram',
  twitter: 'twitter',
  x: 'twitter',
  x_twitter: 'twitter',
  twitter_x: 'twitter',
  x_com: 'twitter',
  youtube: 'youtube',
  yt: 'youtube',
  tiktok: 'tiktok',
  tik_tok: 'tiktok',
  threads: 'threads',
  bluesky: 'bluesky',
  bsky: 'bluesky',
  linkedin: 'linkedin',
  linked_in: 'linkedin',
  reddit: 'reddit',
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'focus', 'primary']);
const FALSE_VALUES = new Set(['', '0', 'false', 'no', 'n']);

function issue(
  row: number,
  column: string | null,
  code: string,
  message: string,
): LandscapeImportIssue {
  return { row, column, code, message };
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (afterQuote) {
      if (char === ',') {
        row.push(field);
        field = '';
        afterQuote = false;
        continue;
      }
      if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        afterQuote = false;
        continue;
      }
      if (char === '\r' || char === ' ' || char === '\t') continue;
      return {
        rows: [],
        error: issue(
          rows.length + 2,
          null,
          'malformed_csv',
          'Unexpected text after a closing quote.',
        ),
      };
    }

    if (char === '"') {
      if (field.length > 0) {
        return {
          rows: [],
          error: issue(
            rows.length + 2,
            null,
            'malformed_csv',
            'A quoted field must begin with a quote.',
          ),
        };
      }
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (char !== '\r') field += char;
  }

  if (quoted) {
    return {
      rows: [],
      error: issue(rows.length + 2, null, 'malformed_csv', 'A quoted field was not closed.'),
    };
  }
  if (afterQuote || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return {
    rows,
    error: null,
  };
}

function canonicalPlatform(value: string): LandscapeImportPlatform | null {
  return PLATFORM_ALIASES[normalizeHeader(value)] ?? null;
}

function profileUrl(input: string): string | null {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizedWebsite(
  input: string,
  row: number,
  column: string,
  errors: LandscapeImportIssue[],
): string | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    return url.toString();
  } catch {
    errors.push(issue(
      row,
      column,
      'invalid_website',
      'Website must be a complete http:// or https:// URL.',
    ));
    return null;
  }
}

function focusValue(
  input: string,
  row: number,
  column: string,
  errors: LandscapeImportIssue[],
): boolean {
  const value = input.trim().toLowerCase();
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  errors.push(issue(
    row,
    column,
    'invalid_focus',
    'Focus must be yes/no, true/false, or 1/0.',
  ));
  return false;
}

function isRivalIqMetadata(header: string): boolean {
  return header === 'company_id'
    || /^(twitter|facebook|youtube|instagram|tiktok)_(posts|audience)_since_date$/.test(header);
}

function addAccount(
  company: LandscapeImportCompany,
  platform: LandscapeImportPlatform,
  input: string,
  row: number,
  column: string,
  errors: LandscapeImportIssue[],
  warnings: LandscapeImportIssue[],
): void {
  const value = input.trim();
  if (!value) return;
  if (!hasAdapter(platform)) {
    errors.push(issue(row, column, 'unsupported_platform', platform + ' cannot be imported.'));
    return;
  }

  let handle: string;
  try {
    handle = getAdapter(platform).parseHandle(value);
  } catch (error) {
    const redditUserRequired = platform === 'reddit'
      && error instanceof Error
      && /must be user accounts/i.test(error.message);
    errors.push(issue(
      row,
      column,
      redditUserRequired ? 'reddit_user_required' : 'invalid_account',
      error instanceof Error ? error.message : 'This account could not be parsed.',
    ));
    return;
  }

  // Data Dumpster tracks Reddit publisher accounts, not communities. The
  // adapter retains legacy subreddit support for existing pooled records, but
  // new landscapes must identify the publisher as u/<username> or /user/… .
  if (platform === 'reddit' && !handle.startsWith('u/')) {
    errors.push(issue(
      row,
      column,
      'reddit_user_required',
      'Reddit must be a user account such as u/bostonglobe or https://reddit.com/user/bostonglobe, not a subreddit.',
    ));
    return;
  }

  // Account names are case-insensitive; only YouTube's canonical UC… channel
  // ids retain case. Store one identity so case variants cannot become two
  // different pooled channels.
  handle = landscapeImportIdentityHandle(platform, handle);

  const duplicate = company.accounts.find(
    (account) => account.platform === platform && account.handle === handle,
  );
  if (duplicate) {
    warnings.push(issue(
      row,
      column,
      'duplicate_account',
      `Duplicate ${platform} account ${handle} was ignored; it first appeared on row ${duplicate.row}.`,
    ));
    return;
  }

  company.accounts.push({
    platform,
    input: value,
    handle,
    profileUrl: profileUrl(value),
    row,
    column,
  });
}

function emptyPreview(
  errors: LandscapeImportIssue[],
  warnings: LandscapeImportIssue[] = [],
): LandscapeImportPreview {
  return {
    format: null,
    companies: [],
    accounts: [],
    errors,
    warnings,
    suggestedFocusCompanyKey: null,
    counts: { companies: 0, accounts: 0, errors: errors.length, warnings: warnings.length },
  };
}

export function parseLandscapeImportCsv(csv: string): LandscapeImportPreview {
  const byteLength = new TextEncoder().encode(csv).byteLength;
  if (byteLength > LANDSCAPE_IMPORT_MAX_BYTES) {
    return emptyPreview([
      issue(0, null, 'file_too_large', 'CSV files may not be larger than 1 MB.'),
    ]);
  }

  const parsed = parseCsv(csv.replace(/^\uFEFF/, ''));
  if (parsed.error) return emptyPreview([parsed.error]);
  const headerIndex = parsed.rows.findIndex(
    (candidate) => candidate.some((cell) => cell.trim().length > 0),
  );
  if (headerIndex < 0) {
    return emptyPreview([issue(1, null, 'empty_csv', 'The CSV is empty.')]);
  }

  const errors: LandscapeImportIssue[] = [];
  const warnings: LandscapeImportIssue[] = [];
  const rawHeaders = parsed.rows[headerIndex];
  const body = parsed.rows.slice(headerIndex + 1);
  const headerRowNumber = headerIndex + 1;
  const headers = rawHeaders.map(normalizeHeader);
  const duplicateHeaders = new Map<string, number>();

  for (const [index, header] of headers.entries()) {
    if (!header) {
      errors.push(issue(
        headerRowNumber,
        rawHeaders[index] || null,
        'blank_header',
        'Every column needs a header.',
      ));
      continue;
    }
    const first = duplicateHeaders.get(header);
    if (first !== undefined) {
      errors.push(issue(
        headerRowNumber,
        rawHeaders[index],
        'duplicate_header',
        `This column duplicates "${rawHeaders[first]}".`,
      ));
    } else {
      duplicateHeaders.set(header, index);
    }
  }

  const findHeader = (aliases: Set<string>): number =>
    headers.findIndex((header) => aliases.has(header));
  const companyColumn = findHeader(COMPANY_HEADERS);
  const websiteColumn = findHeader(WEBSITE_HEADERS);
  const focusColumn = findHeader(FOCUS_HEADERS);
  const segmentColumn = findHeader(SEGMENT_HEADERS);
  const colorColumn = findHeader(COLOR_HEADERS);
  const platformColumn = findHeader(PLATFORM_HEADERS);
  const accountColumn = findHeader(ACCOUNT_HEADERS);
  const wideColumns = headers
    .map((header, index) => ({ platform: canonicalPlatform(header), index }))
    .filter((entry): entry is { platform: LandscapeImportPlatform; index: number } =>
      entry.platform !== null);

  if (companyColumn < 0) {
    errors.push(issue(headerRowNumber, null, 'missing_company_column', 'Add a company column.'));
  }

  const hasLongColumn = platformColumn >= 0 || accountColumn >= 0;
  let format: LandscapeImportFormat | null = null;
  if (platformColumn >= 0 && accountColumn >= 0 && wideColumns.length === 0) {
    format = 'long';
  } else if (!hasLongColumn && wideColumns.length > 0) {
    format = 'wide';
  } else if (platformColumn >= 0 || accountColumn >= 0 || wideColumns.length > 0) {
    errors.push(issue(
      headerRowNumber,
      null,
      'ambiguous_format',
      'Use either platform + account columns, or one column per platform.',
    ));
  } else {
    errors.push(issue(
      headerRowNumber,
      null,
      'missing_account_columns',
      'Add platform and account columns, or one column per platform.',
    ));
  }

  const recognized = new Set<number>([
    companyColumn,
    websiteColumn,
    focusColumn,
    segmentColumn,
    colorColumn,
    platformColumn,
    accountColumn,
    ...wideColumns.map((entry) => entry.index),
  ].filter((index) => index >= 0));

  for (const [index, header] of headers.entries()) {
    if (recognized.has(index) || !header) continue;
    if (header === 'rss') {
      errors.push(issue(
        headerRowNumber,
        rawHeaders[index],
        'unsupported_platform',
        'RSS is not supported.',
      ));
    } else if (isRivalIqMetadata(header)) {
      warnings.push(issue(
        headerRowNumber,
        rawHeaders[index],
        'ignored_metadata',
        `Rival IQ metadata column "${rawHeaders[index]}" is ignored; it does not contain importable history.`,
      ));
    } else {
      errors.push(issue(
        headerRowNumber,
        rawHeaders[index],
        'unknown_column',
        `Column "${rawHeaders[index]}" is not recognized.`,
      ));
    }
  }

  const platformHeader = new Map<LandscapeImportPlatform, number>();
  for (const entry of wideColumns) {
    const first = platformHeader.get(entry.platform);
    if (first !== undefined) {
      errors.push(issue(
        headerRowNumber,
        rawHeaders[entry.index],
        'duplicate_mapped_header',
        `"${rawHeaders[entry.index]}" and "${rawHeaders[first]}" both map to ${entry.platform}.`,
      ));
    } else {
      platformHeader.set(entry.platform, entry.index);
    }
  }

  const companiesByKey = new Map<string, LandscapeImportCompany>();
  const companyOrder: LandscapeImportCompany[] = [];

  for (const [bodyIndex, cells] of body.entries()) {
    const rowNumber = headerIndex + bodyIndex + 2;
    if (!cells.some((cell) => cell.trim().length > 0)) continue;
    if (cells.length > headers.length && cells.slice(headers.length).some((cell) => cell.trim())) {
      errors.push(issue(
        rowNumber,
        null,
        'too_many_columns',
        'This row contains more values than the header.',
      ));
    }

    const name = (cells[companyColumn] ?? '').trim();
    if (!name) {
      errors.push(issue(
        rowNumber,
        companyColumn >= 0 ? rawHeaders[companyColumn] : null,
        'missing_company',
        'Company is required.',
      ));
      continue;
    }
    const slug = slugify(name);
    if (!slug) {
      errors.push(issue(
        rowNumber,
        rawHeaders[companyColumn],
        'invalid_company',
        'Company has no usable characters.',
      ));
      continue;
    }

    const website = websiteColumn >= 0
      ? normalizedWebsite(cells[websiteColumn] ?? '', rowNumber, rawHeaders[websiteColumn], errors)
      : null;
    const focus = focusColumn >= 0
      ? focusValue(cells[focusColumn] ?? '', rowNumber, rawHeaders[focusColumn], errors)
      : false;
    const segment = segmentColumn >= 0 ? (cells[segmentColumn] ?? '').trim() || null : null;
    if (segment && segment.length > 80) {
      errors.push(issue(
        rowNumber,
        rawHeaders[segmentColumn],
        'invalid_segment',
        'Segment may not be longer than 80 characters.',
      ));
    }
    const colorInput = colorColumn >= 0 ? (cells[colorColumn] ?? '').trim() : '';
    const color = colorInput && /^#[0-9a-fA-F]{6}$/.test(colorInput)
      ? colorInput.toUpperCase()
      : null;
    if (colorInput && !color) {
      errors.push(issue(
        rowNumber,
        rawHeaders[colorColumn],
        'invalid_color',
        'Color must be a six-digit hex value such as #C8102E.',
      ));
    }

    let company = companiesByKey.get(slug);
    if (!company) {
      company = {
        key: slug,
        name,
        slug,
        website,
        segment,
        color,
        focus,
        rows: [rowNumber],
        accounts: [],
      };
      companiesByKey.set(slug, company);
      companyOrder.push(company);
    } else {
      company.rows.push(rowNumber);
      if (company.name !== name) {
        warnings.push(issue(
          rowNumber,
          rawHeaders[companyColumn],
          'duplicate_company',
          `"${name}" was merged with "${company.name}" because both normalize to ${slug}.`,
        ));
      }
      if (company.website && website && company.website !== website) {
        errors.push(issue(
          rowNumber,
          rawHeaders[websiteColumn],
          'conflicting_website',
          `"${company.name}" has two different websites in the CSV.`,
        ));
      } else if (!company.website && website) {
        company.website = website;
      }
      if (company.segment && segment && company.segment !== segment) {
        errors.push(issue(
          rowNumber,
          rawHeaders[segmentColumn],
          'conflicting_segment',
          `"${company.name}" has two different segments in the CSV.`,
        ));
      } else if (!company.segment && segment) {
        company.segment = segment;
      }
      if (company.color && color && company.color !== color) {
        errors.push(issue(
          rowNumber,
          rawHeaders[colorColumn],
          'conflicting_color',
          `"${company.name}" has two different colors in the CSV.`,
        ));
      } else if (!company.color && color) {
        company.color = color;
      }
      company.focus = company.focus || focus;
    }

    if (format === 'long') {
      const platformInput = (cells[platformColumn] ?? '').trim();
      const accountInput = (cells[accountColumn] ?? '').trim();
      if (!platformInput && !accountInput) {
        warnings.push(issue(
          rowNumber,
          rawHeaders[accountColumn],
          'missing_account',
          'This row has no account.',
        ));
      } else if (!platformInput || !accountInput) {
        errors.push(issue(
          rowNumber,
          !platformInput ? rawHeaders[platformColumn] : rawHeaders[accountColumn],
          'incomplete_account',
          'Both platform and account are required.',
        ));
      } else {
        const platform = canonicalPlatform(platformInput);
        if (!platform) {
          errors.push(issue(
            rowNumber,
            rawHeaders[platformColumn],
            'unsupported_platform',
            platformInput.toLowerCase() === 'rss'
              ? 'RSS is not supported.'
              : `"${platformInput}" is not a supported platform.`,
          ));
        } else {
          addAccount(
            company,
            platform,
            accountInput,
            rowNumber,
            rawHeaders[accountColumn],
            errors,
            warnings,
          );
        }
      }
    } else if (format === 'wide') {
      for (const { platform, index } of wideColumns) {
        addAccount(
          company,
          platform,
          cells[index] ?? '',
          rowNumber,
          rawHeaders[index],
          errors,
          warnings,
        );
      }
    }
  }

  const accountOwner = new Map<string, { company: LandscapeImportCompany; account: LandscapeImportAccount }>();
  for (const company of companyOrder) {
    if (company.accounts.length === 0) {
      warnings.push(issue(
        company.rows[0],
        null,
        'company_without_accounts',
        `"${company.name}" has no valid accounts and will have no data until a profile is added.`,
      ));
    }
    for (const account of company.accounts) {
      const identity = account.platform + '\u0000' + account.handle;
      const owner = accountOwner.get(identity);
      if (owner && owner.company.key !== company.key) {
        errors.push(issue(
          account.row,
          account.column,
          'account_company_conflict',
          `${account.platform} account ${account.handle} is also assigned to "${owner.company.name}" on row ${owner.account.row}.`,
        ));
      } else {
        accountOwner.set(identity, { company, account });
      }
    }
  }

  const focused = companyOrder.filter((company) => company.focus);
  if (focused.length > 1) {
    for (const company of focused) {
      errors.push(issue(
        company.rows[0],
        focusColumn >= 0 ? rawHeaders[focusColumn] : null,
        'multiple_focus_companies',
        'Only one company can be marked as the focus company.',
      ));
    }
  }
  // Zero focused companies is not a defect: a landscape may deliberately be a
  // market watched from outside, and the review step offers the choice anyway.

  const accounts = companyOrder.flatMap((company) => company.accounts);
  if (companyOrder.length > LANDSCAPE_IMPORT_MAX_COMPANIES) {
    errors.push(issue(
      1,
      null,
      'too_many_companies',
      `A landscape may contain at most ${LANDSCAPE_IMPORT_MAX_COMPANIES} companies.`,
    ));
  }
  if (accounts.length > LANDSCAPE_IMPORT_MAX_ACCOUNTS) {
    errors.push(issue(
      1,
      null,
      'too_many_accounts',
      `A CSV may contain at most ${LANDSCAPE_IMPORT_MAX_ACCOUNTS} accounts.`,
    ));
  }
  if (companyOrder.length === 0 && errors.length === 0) {
    errors.push(issue(1, null, 'no_companies', 'The CSV contains no companies.'));
  }

  return {
    format,
    companies: companyOrder,
    accounts,
    errors,
    warnings,
    suggestedFocusCompanyKey: focused.length === 1 ? focused[0].key : null,
    counts: {
      companies: companyOrder.length,
      accounts: accounts.length,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}
