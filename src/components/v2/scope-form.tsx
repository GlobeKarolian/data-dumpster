"use client";
import * as React from 'react';
import type { V2State, V2Path } from '@/lib/v2/state';
import { transitionUrl } from '@/lib/v2/state';
import { PLATFORM_LABELS, PLATFORMS, type CompanyRef } from '@/lib/types';

export function ScopeForm({ state, path, landscapes, companies }: { state: V2State; path: V2Path; landscapes: { id: string; name: string }[]; companies: CompanyRef[] }) {
  const hidden = (except: string[]) => [...new URLSearchParams(transitionUrl(path, state).split('?')[1])].filter(([k]) => !except.includes(k) && !['page', 'post', 'inspect'].includes(k)).map(([k,v]) => <input key={k} type="hidden" name={k} value={v} />);
  return <div className="v2-scope-forms">
    <form action={path} method="get" className="v2-landscape-form">
      {hidden(['landscape', 'companies'])}
      <label>Landscape<select name="landscape" defaultValue={state.landscape} aria-label="Landscape">{landscapes.map(l => <option value={l.id} key={l.id}>{l.name}</option>)}</select></label>
      <button type="submit" className="v2-button v2-small">Switch</button>
    </form>
    <form action={path} method="get" className="v2-filter-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      window.location.assign(transitionUrl(path, state, { range: form.get('range') as V2State['range'], platforms: String(form.get('platforms') ?? ''), companies: String(form.get('companies') ?? '') }));
    }}>
      {hidden(['range', 'platforms', 'companies'])}
      <label>{path === '/v2' ? 'Explore window' : 'Window'}<select name="range" defaultValue={state.range}>
        <option value="7d">Last 7 days</option><option value="28d">Last 28 days</option><option value="90d">Last 90 days</option>
        {state.range === '24h' && <option value="24h">Today’s pinned 24 hours</option>}
        {state.range === 'custom' && <option value="custom">Custom dates</option>}
      </select></label>
      <label>Platform<select name="platforms" defaultValue={state.platforms}>
        <option value="">All platforms</option>{state.platforms.includes(',') && <option value={state.platforms}>Multiple platforms</option>}
        {PLATFORMS.filter(p => p !== 'rss').map(p => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
      </select></label>
      <label>Company<select name="companies" defaultValue={state.companies}>
        <option value="">All companies</option>{state.companies.includes(',') && <option value={state.companies}>Multiple companies</option>}
        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      <button className="v2-button" type="submit">Apply scope</button>
    </form>
  </div>;
}
