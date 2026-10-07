export type ReportLandscapeDestinationInput = {
  reportId: string;
  reportLandscapeId: string | null;
  selectedLandscapeId: string | null;
  landscapeWasExplicit: boolean;
  alternateReportId: string | null;
  searchParams: URLSearchParams;
  platformAdmin?: boolean;
};

/**
 * Ordinary report indexes stay aligned with the landscape selected in the
 * shell. The named platform administrator gets one organization-wide catalog,
 * so no report is hidden behind a landscape switch.
 */
export function reportIndexLandscapeScope(
  selectedLandscapeId: string | null,
  platformAdmin: boolean,
): string | null {
  return platformAdmin ? null : selectedLandscapeId;
}

/** A list link must carry the report's own landscape into the editor. */
export function reportListLandscape(
  reportLandscapeId: string | null,
  selectedLandscapeId: string | null,
): string | null {
  return reportLandscapeId ?? selectedLandscapeId;
}

/**
 * Keep the global landscape label and a saved weekly report in agreement.
 *
 * A report is a dated snapshot owned by one landscape. Changing the shell
 * cannot safely reinterpret that snapshot as a different cohort: pasted
 * tables and editorial narrative belong to the original report too. When the
 * user explicitly switches landscapes, open the matching report for the same
 * week when one exists; otherwise return to that landscape's report index.
 */
export function reportLandscapeDestination({
  reportId,
  reportLandscapeId,
  selectedLandscapeId,
  landscapeWasExplicit,
  alternateReportId,
  searchParams,
  platformAdmin = false,
}: ReportLandscapeDestinationInput): string | null {
  if (platformAdmin) return null;
  if (!reportLandscapeId || !selectedLandscapeId) return null;

  if (reportLandscapeId === selectedLandscapeId) return null;

  const next = new URLSearchParams(searchParams);
  next.delete('companies');

  if (!landscapeWasExplicit) {
    next.set('landscape', reportLandscapeId);
    return '/reports/' + reportId + '?' + next.toString();
  }

  next.set('landscape', selectedLandscapeId);
  const path = alternateReportId ? '/reports/' + alternateReportId : '/reports';
  return path + '?' + next.toString();
}
