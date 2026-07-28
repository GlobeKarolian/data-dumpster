'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

export type ParamPatch = Record<string, string | string[] | null | undefined>;

/**
 * Filters live in the URL, not in component state.
 *
 * That is a product decision, not a technical one: every view in Pressbox is
 * something somebody will paste into Slack to make an argument, and a link that
 * does not carry its own filters is a link that starts a different argument.
 */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParams = React.useCallback(
    (patch: ParamPatch, options?: { replace?: boolean; scroll?: boolean }) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === '') {
          next.delete(key);
        } else if (Array.isArray(value)) {
          if (value.length === 0) next.delete(key);
          else next.set(key, value.join(','));
        } else {
          next.set(key, value);
        }
      }
      const qs = next.toString();
      const url = qs ? pathname + '?' + qs : pathname;
      if (options?.replace) router.replace(url, { scroll: options.scroll ?? false });
      else router.push(url, { scroll: options?.scroll ?? false });
    },
    [pathname, router, searchParams],
  );

  const getList = React.useCallback(
    (key: string): string[] => {
      const raw = searchParams.get(key);
      if (!raw) return [];
      return raw.split(',').filter(Boolean);
    },
    [searchParams],
  );

  return { searchParams, pathname, setParams, getList, router };
}

/** Build a href that preserves the current query while changing the path. */
export function hrefWithParams(pathname: string, searchParams: URLSearchParams, patch?: ParamPatch): string {
  const next = new URLSearchParams(searchParams.toString());
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null || value === undefined || value === '') next.delete(key);
    else if (Array.isArray(value)) {
      if (value.length === 0) next.delete(key);
      else next.set(key, value.join(','));
    } else next.set(key, value);
  }
  const qs = next.toString();
  return qs ? pathname + '?' + qs : pathname;
}
