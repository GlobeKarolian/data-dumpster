'use client';

import * as React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatRelative } from '@/components/ui/format';
import {
  MANUAL_SECTIONS,
  NARRATIVE_SECTIONS,
  periodLabel,
  type ComputedBlock,
  type ManualState,
  type ManualTable,
  type NarrativeBlock,
} from '@/lib/reports/types';
import { emptyTable } from '@/lib/reports/tsv';
import type { ReportDocument } from '@/lib/reports/render';
import { BrandsSection, CohortSection, PerformanceSection, RecomputeBar, TopPostsSection } from './computed-panel';
import { ExportActions } from './export-actions';
import { FigureFields } from './figure-fields';
import { NarrativeField } from './narrative-field';
import { PasteBox } from './paste-box';

export type ReportBuilderProps = {
  reportId: string;
  orgName: string;
  landscapeName: string | null;
  canEdit: boolean;
  initial: {
    title: string;
    dataNote: string | null;
    status: string;
    periodStart: string;
    periodEnd: string;
    computed: ComputedBlock | null;
    manual: ManualState;
    narrative: NarrativeBlock;
  };
};

type SaveState = { phase: 'clean' | 'dirty' | 'saving' | 'error'; at: string | null; message?: string };

const specById = new Map(NARRATIVE_SECTIONS.map((s) => [s.id, s]));

function sectionSpec(id: string) {
  const spec = specById.get(id);
  if (!spec) throw new Error('Unknown narrative section: ' + id);
  return spec;
}

/**
 * The builder.
 *
 * One client component owns the whole editable surface because the export has
 * to see the document exactly as the author currently sees it, unsaved edits
 * included. Splitting the state across islands would mean "Copy for Google
 * Docs" could produce a version that differs from the screen, which for a
 * document that goes to the chief executive is the worst possible bug.
 *
 * Saving is debounced and automatic, with an explicit button for people who do
 * not trust debounced and automatic. The computed block is never sent on save;
 * it is only ever replaced by a recompute, which is the guarantee the whole
 * design rests on.
 */
export function ReportBuilder({ reportId, orgName, landscapeName, canEdit, initial }: ReportBuilderProps) {
  const [title, setTitle] = React.useState(initial.title);
  const [dataNote, setDataNote] = React.useState(initial.dataNote ?? '');
  const [manual, setManual] = React.useState<ManualState>(initial.manual);
  const [narrative, setNarrative] = React.useState<NarrativeBlock>(initial.narrative);
  const [computed, setComputed] = React.useState<ComputedBlock | null>(initial.computed);
  const [save, setSave] = React.useState<SaveState>({ phase: 'clean', at: null });
  const [recomputing, setRecomputing] = React.useState(false);
  const [recomputeError, setRecomputeError] = React.useState<string | null>(null);

  const period = React.useMemo(
    () => ({ start: initial.periodStart, end: initial.periodEnd }),
    [initial.periodStart, initial.periodEnd],
  );

  /**
   * Marking the document dirty is an edit event, not a render consequence, so
   * every setter goes through here rather than through an effect that watches
   * state. An effect that calls setState is a cascading render waiting to
   * happen, and this component re-renders on every keystroke already.
   */
  const touch = React.useCallback(() => {
    setSave((s) => (s.phase === 'saving' ? s : { phase: 'dirty', at: s.at }));
  }, []);

  const doc: ReportDocument = React.useMemo(() => ({
    title,
    orgName,
    period,
    dataNote: dataNote.trim() ? dataNote.trim() : null,
    computed,
    manual,
    narrative,
  }), [title, orgName, period, dataNote, computed, manual, narrative]);

  const persist = React.useCallback(async (): Promise<boolean> => {
    setSave({ phase: 'saving', at: null });
    try {
      const res = await fetch('/api/reports/' + reportId, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          dataNote: dataNote.trim() ? dataNote.trim() : null,
          manual,
          narrative,
        }),
      });
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        const message = typeof payload === 'object' && payload !== null && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : 'Save failed with status ' + res.status + '.';
        throw new Error(message);
      }
      setSave({ phase: 'clean', at: new Date().toISOString() });
      return true;
    } catch (err) {
      setSave({
        phase: 'error',
        at: null,
        message: err instanceof Error ? err.message : 'Save failed.',
      });
      return false;
    }
  }, [reportId, title, dataNote, manual, narrative]);

  // Debounced autosave. The first render is skipped so opening a report is not a write.
  const mounted = React.useRef(false);
  React.useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (!canEdit) return;
    const timer = setTimeout(() => { void persist(); }, 1200);
    return () => clearTimeout(timer);
    // persist changes identity with the fields it saves, which is exactly the trigger we want.
  }, [canEdit, persist]);

  const recompute = async () => {
    if (!window.confirm(
      'Recompute the figures? Existing narrative will be cleared because it was '
        + 'verified against the current snapshot.',
    )) return;
    setRecomputing(true);
    setRecomputeError(null);
    try {
      // Let any pending human edits settle before the server atomically replaces
      // the computed snapshot and invalidates its narrative.
      await persist();
      const res = await fetch('/api/reports/' + reportId + '/recompute', { method: 'POST' });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message = typeof payload === 'object' && payload !== null && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : 'Recompute failed with status ' + res.status + '.';
        throw new Error(message);
      }
      const next = typeof payload === 'object' && payload !== null && 'computed' in payload
        ? (payload as { computed: ComputedBlock | null }).computed
        : null;
      setComputed(next);
      setNarrative({});
    } catch (err) {
      setRecomputeError(err instanceof Error ? err.message : 'Recompute failed.');
    } finally {
      setRecomputing(false);
    }
  };

  const setTable = (id: string, table: ManualTable) => {
    setManual((m) => ({ ...m, tables: { ...m.tables, [id]: table } }));
    touch();
  };

  const setFigures = (figures: Record<string, string>) => {
    setManual((m) => ({ ...m, figures }));
    touch();
  };

  const setNarrativeSection = (id: string, next: string) => {
    setNarrative((n) => ({ ...n, [id]: next }));
    touch();
  };

  const editTitle = (next: string) => { setTitle(next); touch(); };
  const editDataNote = (next: string) => { setDataNote(next); touch(); };

  const narrativeFor = (id: string) => (
    <NarrativeField
      spec={sectionSpec(id)}
      reportId={reportId}
      value={narrative[id] ?? ''}
      onChange={(next) => setNarrativeSection(id, next)}
      disabled={!canEdit}
    />
  );

  const searchSections = MANUAL_SECTIONS.filter((s) => s.id.endsWith('Search'));
  const referralSections = MANUAL_SECTIONS.filter((s) => s.id.endsWith('Referral'));

  return (
    <div className="space-y-4 pb-16">
      <header className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-600 dark:text-accent-500">
          Do not forward — confidential
        </p>
        <input
          value={title}
          onChange={(e) => editTitle(e.target.value)}
          disabled={!canEdit}
          aria-label="Report title"
          className="w-full border-0 bg-transparent p-0 text-lg font-semibold tracking-tight text-zinc-900 focus:outline-none dark:text-zinc-50"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="pb-num text-[11px] text-zinc-500 dark:text-zinc-400">
            {orgName + ' · ' + periodLabel(period)
              + (landscapeName ? ' · ' + landscapeName : '')}
          </p>
          <div className="flex items-center gap-2">
            <SaveIndicator state={save} canEdit={canEdit} onSave={() => { void persist(); }} />
            <Badge tone={initial.status === 'final' ? 'positive' : 'neutral'}>
              {initial.status === 'final' ? 'Final' : 'Draft'}
            </Badge>
          </div>
        </div>
        <ExportActions
          doc={doc}
          reportId={reportId}
          beforeServerExport={canEdit ? persist : undefined}
        />
      </header>

      <section className="rounded-lg border border-amber-300/70 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500" aria-hidden />
          <label
            htmlFor="report-data-note"
            className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-500"
          >
            Important note
          </label>
        </div>
        <textarea
          id="report-data-note"
          value={dataNote}
          onChange={(e) => editDataNote(e.target.value)}
          disabled={!canEdit}
          rows={2}
          placeholder="Left empty, no banner appears. Use it when a data stream was broken, for example when the TikTok API was down and that brand is omitted."
          className="mt-2 w-full rounded-md border border-amber-300/60 bg-white/70 px-3 py-2 text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:border-amber-500 focus:outline-none dark:border-amber-900/50 dark:bg-zinc-900/60 dark:text-zinc-100 dark:placeholder:text-zinc-600"
        />
      </section>

      <RecomputeBar
        computedAt={computed?.generatedAt ?? null}
        busy={recomputing}
        disabled={!canEdit}
        onRecompute={() => { void recompute(); }}
        error={recomputeError}
      />

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Executive Summary
        </h2>
        <div className="mt-3">{narrativeFor('executiveSummary')}</div>
      </div>

      {computed ? (
        <>
          <PerformanceSection computed={computed} />
          <div className="space-y-3">
            <BrandsSection computed={computed} />
            <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
              {narrativeFor('brands')}
            </div>
          </div>
          <TopPostsSection computed={computed} />
        </>
      ) : (
        <NotComputedYet />
      )}

      <div className="space-y-3">
        {searchSections.map((spec) => (
          <PasteBox
            key={spec.id}
            spec={spec}
            table={manual.tables[spec.id] ?? emptyTable()}
            onChange={(next) => setTable(spec.id, next)}
            disabled={!canEdit}
          />
        ))}
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          {narrativeFor('search')}
        </div>
      </div>

      <div className="space-y-3">
        {referralSections.map((spec) => (
          <PasteBox
            key={spec.id}
            spec={spec}
            table={manual.tables[spec.id] ?? emptyTable()}
            onChange={(next) => setTable(spec.id, next)}
            disabled={!canEdit}
          />
        ))}
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          {narrativeFor('referral')}
        </div>
      </div>

      <div className="space-y-3">
        <FigureFields
          values={manual.figures}
          onChange={setFigures}
          disabled={!canEdit}
        />
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          {narrativeFor('paid')}
        </div>
      </div>

      {computed ? (
        <div className="space-y-3">
          <CohortSection computed={computed} />
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            {narrativeFor('cohort')}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SaveIndicator({
  state,
  canEdit,
  onSave,
}: {
  state: SaveState;
  canEdit: boolean;
  onSave: () => void;
}) {
  if (!canEdit) {
    return <span className="text-[11px] text-zinc-500">Read only. Editing needs the editor role.</span>;
  }
  if (state.phase === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Saving
      </span>
    );
  }
  if (state.phase === 'error') {
    return (
      <span className="inline-flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400">
        {state.message ?? 'Save failed.'}
        <Button size="sm" variant="secondary" onClick={onSave}>Retry</Button>
      </span>
    );
  }
  if (state.phase === 'dirty') {
    return (
      <span className="inline-flex items-center gap-2 text-[11px] text-zinc-500">
        Unsaved changes
        <Button size="sm" variant="ghost" onClick={onSave}>Save now</Button>
      </span>
    );
  }
  return (
    <span className="text-[11px] text-zinc-500">
      {state.at ? 'Saved ' + formatRelative(state.at) : 'Saved'}
    </span>
  );
}

function NotComputedYet() {
  return (
    <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        The computed figures are not available for this report.
      </p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        This happens when a report was written by an earlier version of the app, or when the
        landscape it was built on has been deleted. Recompute to derive them again.
      </p>
    </section>
  );
}
