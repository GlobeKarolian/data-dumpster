'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/utils';
import { dayKey, dayLabel, fmtTime, STATUS_LABEL } from './api';
import { usePublishingData } from './workspace';
import { StoryDrawer, headlineOf } from './story-drawer';

function startOfWeek(offset: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + offset * 7);
  return d;
}

const TONE: Record<string, string> = {
  queued: 'border-accent-600/40 bg-accent-600/5',
  sending: 'border-accent-600/40 bg-accent-600/5',
  sent: 'border-emerald-500/40 bg-emerald-500/5',
  failed: 'border-red-500/50 bg-red-500/5',
  held: 'border-amber-500/50 bg-amber-500/5 border-dashed',
};

/**
 * Week calendar across every brand and platform, the one thing the team said
 * it liked about Hootsuite. Held posts (awaiting approval) show dashed at the
 * start of their window so the plan is visible before anyone approves it.
 */
export function PublishCalendar() {
  const [week, setWeek] = React.useState(0);
  const [brand, setBrand] = React.useState('');
  const [source, setSource] = React.useState('');
  const [openId, setOpenId] = React.useState<string | null>(null);
  const start = React.useMemo(() => startOfWeek(week), [week]);
  const end = React.useMemo(() => new Date(start.getTime() + 7 * 86400_000), [start]);
  const { targets, posts, error } = usePublishingData({ from: start.toISOString(), to: end.toISOString() });

  const days = Array.from({ length: 7 }, (_, i) => dayKey(new Date(start.getTime() + i * 86400_000 + 12 * 3600_000).toISOString()));
  const items = posts.flatMap((p) => p.deliveries
    .filter((d) => !brand || d.brand === brand)
    .filter(() => !source || (source === 'rss' ? p.origin === 'rss' : source === 'optimized' ? p.origin !== 'rss' && p.timing.mode === 'window' : p.origin !== 'rss' && p.timing.mode === 'exact'))
    .filter((d) => d.status !== 'canceled' && d.status !== 'unschedulable')
    .map((d) => {
      const when = d.sent_at ?? d.scheduled_for ?? (p.timing.mode === 'window' ? p.timing.start : p.timing.at);
      return { p, d, when };
    }))
    .filter((x) => days.includes(dayKey(x.when)))
    .sort((a, b) => a.when.localeCompare(b.when));
  const brands = [...new Set((targets ?? []).map((t) => t.brand))];

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>{dayLabel(days[0])} to {dayLabel(days[6])}</CardTitle>
          <div className="flex items-center gap-1.5">
            <div className="w-36">
              <Select size="sm" value={source} onChange={(e) => setSource(e.target.value)}
                options={[{ value: '', label: 'All posts' }, { value: 'optimized', label: 'Best time' }, { value: 'scheduled', label: 'Set time' }]} />
            </div>
            <div className="w-40">
              <Select size="sm" value={brand} onChange={(e) => setBrand(e.target.value)}
                options={[{ value: '', label: 'All brands' }, ...brands.map((b) => ({ value: b, label: b }))]} />
            </div>
            <Button size="icon" variant="ghost" aria-label="Previous week" onClick={() => setWeek(week - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" onClick={() => setWeek(0)}>This week</Button>
            <Button size="icon" variant="ghost" aria-label="Next week" onClick={() => setWeek(week + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          <div className="grid min-w-[56rem] grid-cols-7 gap-2">
            {days.map((k) => {
              const today = k === dayKey(new Date().toISOString());
              const list = items.filter((x) => dayKey(x.when) === k);
              return (
                <div key={k} className={cn('min-h-64 rounded-md border border-zinc-200 p-1.5 dark:border-zinc-800', today && 'border-accent-600/60')}>
                  <p className={cn('mb-1.5 px-0.5 text-[11px] font-semibold', today ? 'text-accent-700 dark:text-accent-400' : 'text-zinc-500')}>
                    {dayLabel(k).replace(/,.*$/, '')} {k.slice(8)}
                  </p>
                  <div className="space-y-1">
                    {list.map(({ p, d, when }) => (
                      <button
                        type="button"
                        key={d.id}
                        onClick={() => setOpenId(p.id)}
                        title={`${d.brand} · ${STATUS_LABEL[d.status]}`}
                        className={cn('block w-full rounded border px-1.5 py-1 text-left text-[11px] leading-tight hover:shadow-sm', TONE[d.status] ?? 'border-zinc-200')}
                      >
                        <span className="flex items-center gap-1 text-zinc-500">
                          <PlatformIcon platform={d.platform} className="h-3 w-3" />
                          <span className="pb-num">{fmtTime(when)}</span>
                          <span className="truncate">{d.brand}</span>
                        </span>
                        <span className="line-clamp-2 text-zinc-800 dark:text-zinc-200">{headlineOf(p)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>
      {openId && posts.find((x) => x.id === openId) ? <StoryDrawer post={posts.find((x) => x.id === openId)!} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
