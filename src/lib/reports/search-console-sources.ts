export type SearchTableId = 'globeSearch' | 'bostonSearch';

/** Human-auditable source reports. Credentials are deliberately kept elsewhere. */
export const SEARCH_DASHBOARDS: Record<SearchTableId, { label: string; url: string }> = {
  globeSearch: {
    label: 'Globe.com Search Console dashboard',
    url: 'https://datastudio.google.com/u/0/reporting/bee9d7b7-6f7b-44d8-81bf-7232c2e9d4e8/page/qOVwC',
  },
  bostonSearch: {
    label: 'Boston.com Search Console dashboard',
    url: 'https://datastudio.google.com/u/0/reporting/95f92bb2-d6c9-446c-b0c4-99c830531fe4/page/qOVwC',
  },
};
