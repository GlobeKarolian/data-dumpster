"use client";
import * as React from 'react';
import { safeWebUrl } from '@/lib/v2/presentation';
/**
 * Prefer private retained media, then the stored CDN URL. Never refresh upstream.
 *
 * `archived === false` skips the archive request entirely. Asking for every
 * post's archive cost one guaranteed 404 (and a console error) per thumbnail
 * for the platforms that never archive, before falling back to the same URL.
 */
export function PostMedia({ url, company, large = false, postId, landscape, archived }: { url: string | null; company: string; large?: boolean; postId?: string; landscape?: string; archived?: boolean }) {
  const [stage, setStage] = React.useState(0);
  const archive = postId && landscape && archived !== false ? `/v2/media/${encodeURIComponent(postId)}?landscape=${encodeURIComponent(landscape)}` : null;
  const stored = safeWebUrl(url);
  const src = stage === 0 ? archive || stored : stage === 1 && archive ? stored : null;
  return <div className={'v2-media' + (large ? ' v2-media-large' : '')}>{src ?
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={'Post media from ' + company} loading="lazy" referrerPolicy="no-referrer" onError={() => setStage(s => s+1)} />
    : <span>{stage > 0 ? 'Preview unavailable' : 'No stored preview'}</span>}</div>;
}
