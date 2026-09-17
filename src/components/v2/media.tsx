"use client";
import * as React from 'react';
import { safeWebUrl } from '@/lib/v2/presentation';
/** Prefer private retained media, then the stored CDN URL. Never refresh upstream. */
export function PostMedia({ url, company, large = false, postId, landscape }: { url: string | null; company: string; large?: boolean; postId?: string; landscape?: string }) {
  const [stage, setStage] = React.useState(0);
  const archive = postId && landscape ? `/v2/media/${encodeURIComponent(postId)}?landscape=${encodeURIComponent(landscape)}` : null;
  const stored = safeWebUrl(url);
  const src = stage === 0 ? archive || stored : stage === 1 && archive ? stored : null;
  return <div className={'v2-media' + (large ? ' v2-media-large' : '')}>{src ?
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={'Post media from ' + company} loading="lazy" referrerPolicy="no-referrer" onError={() => setStage(s => s+1)} />
    : <span>{stage > 0 ? 'Preview unavailable' : 'No stored preview'}</span>}</div>;
}
