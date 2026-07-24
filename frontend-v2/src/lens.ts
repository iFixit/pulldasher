export type Lens = 'review' | 'mine' | 'team' | 'classic' | 'ci' | 'stats';

/** Canonical label for each lens — the single source every surface naming the
 * six views reads from: the tab strip and phone dropdown (app.tsx /
 * LensMenu), saved-filter descriptions (model/savedFilters.ts), and the
 * Settings panel's lens pickers (components/Settings.tsx). One restated copy
 * (model/savedFilters.ts's old LENS_LABEL) drifted and was missing `ci`,
 * rendering a saved CI-lens filter as "ci lens" instead of "CI lens". */
export const LENS_LABELS: Record<Lens, string> = {
   review: 'Review',
   mine: 'My work',
   team: 'Team',
   classic: 'Classic',
   ci: 'CI',
   stats: 'Stats',
};
