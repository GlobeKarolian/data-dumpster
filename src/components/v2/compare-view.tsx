import * as React from 'react';
import Link from 'next/link';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import { COMPARE_METRICS, type V2Data } from '@/lib/v2/reader';
import { transitionUrl, type CompareTab } from '@/lib/v2/state';
import { deltaText, metricText, qualityLabel } from '@/lib/v2/presentation';
import { Health } from './health';
export function CompareView({ data }: { data: V2Data }) {
  const { ctx, state, rows, metric, coverage } = data;
  const definition = METRIC_DEFS[metric];
  const max = Math.max(0, ...rows.filter(r => r.available).map(r => r.value));
  return <>
    <header className="v2-page-heading"><div><p className="v2-eyebrow">Compare / {ctx.landscape?.name}</p><h1>See the differences<span className="v2-heading-dot">.</span></h1><p>Aligned company observations. Compare like with like; check coverage first.</p></div></header>
    <nav className="v2-tabs" aria-label="Comparison category">{(['publishing', 'engagement', 'audience'] as CompareTab[]).map(tab => <Link key={tab} href={transitionUrl('/v2/compare', state, { tab, metric: COMPARE_METRICS[tab][0] })} aria-current={state.tab === tab ? 'page' : undefined}>{tab.charAt(0).toUpperCase()+tab.slice(1)}</Link>)}</nav>
    <div className="v2-compare-controls"><nav className="v2-metric-choices" aria-label="Metric">{COMPARE_METRICS[state.tab].map(key => <Link key={key} className="v2-chip" aria-current={key === metric ? 'true' : undefined} href={transitionUrl('/v2/compare', state, { metric: key })}>{METRIC_DEFS[key].label}</Link>)}</nav><a className="v2-inline-link" href="#source-health">Check source coverage ↓</a></div>
    <div className="v2-definition"><strong>{definition.label}</strong><p>{definition.formula}.</p><p className="v2-note">{metric === 'audience' ? 'Latest measured follower stock per channel inside the window. Not unique people across platforms. No inferred growth is shown.' : 'Observed values only. Unavailable values are blank; period changes are withheld unless both periods are measured and certified complete. Cross-platform reaction types differ.'}</p></div>
    <div className="v2-compare-columns"><section aria-labelledby="company-comparison"><div className="v2-section-heading"><h2 id="company-comparison">Company comparison</h2><span>{rows.length} companies</span></div>
      {rows.length ? <><div className="v2-bars" role="img" aria-label={definition.label + ' by company; exact values and completeness in the table below'}>{rows.map(row => <div key={row.company.id} className={'v2-bar-row' + (row.company.id === ctx.focusCompanyId ? ' is-focus' : '')}>
        <Link href={transitionUrl('/v2/posts', state, { companies: row.company.id })}>{row.company.name}</Link><div className="v2-bar-track"><span style={{ width: `${row.available && max > 0 ? Math.max(0, row.value / max * 100) : 0}%` }} /></div><strong>{metricText(metric, row.value, row.available)}</strong>
      </div>)}</div>
      <div className="v2-table-scroll"><table className="v2-table"><caption>{definition.label} · company values and measurement quality</caption><thead><tr><th scope="col">Company</th><th scope="col" className="v2-number">{definition.shortLabel}</th><th scope="col">Quality</th><th scope="col" className="v2-number">vs prior period</th></tr></thead><tbody>{rows.map(row => <tr key={row.company.id} className={row.company.id === ctx.focusCompanyId ? 'is-focus' : undefined}><th scope="row"><Link href={transitionUrl('/v2/posts', state, { companies: row.company.id })}>{row.company.name}</Link>{row.company.id === ctx.focusCompanyId && <span className="v2-focus-label">Focus</span>}</th><td className="v2-number">{metricText(metric, row.value, row.available)}</td><td><span className={'v2-quality'+(row.complete ? ' is-complete' : '')}>{qualityLabel(row)}</span></td><td className="v2-number">{deltaText(row)}</td></tr>)}</tbody></table></div>
      <p className="v2-note">Select a company to explore its posts with the same date and platform scope. Red marks the landscape’s focus company, not a winner. — means unavailable or withheld.</p></> : <div className="v2-empty"><h3>No companies to compare</h3><p>Choose a landscape with tracked companies or clear the company filter.</p></div>}
    </section><aside><Health coverage={coverage} landscape={state.landscape} /></aside></div>
  </>;
}
