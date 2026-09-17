import * as React from 'react';
import Link from 'next/link';
import type { V2Data } from '@/lib/v2/reader';
import { transitionUrl, type V2Path } from '@/lib/v2/state';
import { timestamp } from '@/lib/v2/presentation';
import { ScopeForm } from './scope-form';
import { CopyLink } from './copy-link';
export function Workspace({ data, path, children }: { data: V2Data; path: V2Path; children?: React.ReactNode }) {
  const { ctx, state, range } = data;
  const legacyScope = '?landscape=' + encodeURIComponent(state.landscape);
  return <div className="v2-workspace">
    <a className="v2-skip" href="#v2-main">Skip to content</a>
    <aside className="v2-sidebar">
      <Link className="v2-brand" href={transitionUrl('/v2', state)}>Data<br />Dumpster <span>V2</span></Link>
      <p className="v2-eyebrow v2-nav-caption">Editorial console</p>
      <nav aria-label="V2 navigation">{([['/v2','Today','01'], ['/v2/compare','Compare','02'], ['/v2/posts','Posts','03']] as const).map(([href,label,num]) => <Link key={href} href={transitionUrl(href, state)} aria-current={path === href ? 'page' : undefined}><span className="v2-nav-number">{num}</span>{label}</Link>)}</nav>
      <div className="v2-secondary-nav"><Link href={'/reports'+legacyScope}>Reports <span>↗</span></Link><Link href={'/settings/sources'+legacyScope}>Data sources <span>↗</span></Link><Link href={'/cross-channel'+legacyScope}>Original app <span>↗</span></Link></div>
      <p className="v2-sidebar-note">Stored observations.<br />No collection controls.</p>
    </aside>
    <div className="v2-workspace-body">
      <header className="v2-topline"><span>Boston Globe Media <span className="v2-muted">/ Social intelligence</span></span><CopyLink /></header>
      <section className="v2-scope" aria-label="Current scope">
        <ScopeForm key={path + JSON.stringify(state)} path={path} state={state} landscapes={ctx.landscapes} companies={ctx.companies} />
        <div className="v2-scope-caption"><span>{path === '/v2' ? 'Today is fixed to the last 24 hours. The explore window applies to Compare and Posts.' : 'Publication window · America/New_York'}</span><span>{timestamp(range.start)} — {timestamp(range.end)}</span></div>
      </section>
      <main id="v2-main" className="v2-main">{!ctx.landscape ? <div className="v2-empty"><h1>No landscapes available</h1><p>Ask an administrator to grant access to a landscape. No observations have been queried.</p></div> : children}</main>
      <footer className="v2-footer">Data Dumpster / V2 <span>Public-source observations · Missing is not zero</span></footer>
    </div>
  </div>;
}
