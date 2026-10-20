export type Lens = 'review' | 'mine' | 'team' | 'projects' | 'classic' | 'ci' | 'stats';

/** The Projects tab's default date range. It lives here, not in
 * model/projectData.ts, so app.tsx can read and write the URL without
 * pulling the tab's code into the review board's bundle. */
export const DEFAULT_RANGE = '30d';

/** What the URL holds when nobody picked the project list's sort, which the
 * list reads as its default order: what's owed first, then the rest (the
 * Plan column's order). Kept here for the same reason (model/portfolio.ts
 * reads it); Last activity's own key is `last`. */
export const DEFAULT_SORT = 'idle';

/** What the URL holds when nobody picked how the Overview's list and the
 * Roadmap split their rows: by initiative, so both open on the short list
 * of ranked initiatives. Kept here for the same reason. */
export const DEFAULT_GROUP = 'initiative';

/** The groupings the Group by switch offers (model/portfolio.ts GROUPINGS;
 * a test holds the two lists together). */
export const GROUP_KEYS = ['none', 'initiative', 'lead', 'team'];

/** A grouping from the URL: one the switch offers, else the default, so an
 * old link's `group=parent` shows a grouping the switch has picked. */
export const groupParam = (key: string | null | undefined): string =>
   key && GROUP_KEYS.includes(key) ? key : DEFAULT_GROUP;

/** A year the board draws, 1970 to 2999, so a hand-edited key can't reach
 * the years `new Date` reads as 19xx, or a horizon in the year 10000. */
const YEAR = '(19[7-9]\\d|2\\d{3})';

/** A picked week from the URL: a real day that is a Monday, as the load
 * chart's weeks start, else null. */
export function weekParam(key: string | null | undefined): string | null {
   const m = new RegExp(`^${YEAR}-(\\d{2})-(\\d{2})$`).exec(key ?? '');
   if (!m) return null;
   const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
   return day.toISOString().slice(0, 10) === key && day.getUTCDay() === 1 ? key : null;
}

/** A roadmap zoom's key in the URL, "2026-Q4" or "2026-10", checked here for
 * the same reason (model/roadmapTime.ts reads it). */
export const ZOOM_KEY = new RegExp(`^${YEAR}-(?:Q([1-4])|(0[1-9]|1[0-2]))$`);

/** The longest window the roadmap draws: five years. A longer link is cut
 * to it, so a typo can't draw a century of columns. */
export const MAX_WINDOW_MONTHS = 60;

const WINDOW_PRESET_KEYS = ['quarter', '2q', '6m', 'ytd', '12m', 'year'];
const MONTHS_KEY = new RegExp(`^${YEAR}-(0[1-9]|1[0-2])\\.\\.${YEAR}-(0[1-9]|1[0-2])$`);
const QUARTERS_KEY = new RegExp(`^${YEAR}-Q([1-4])\\.\\.${YEAR}-Q([1-4])$`);

/**
 * The roadmap's window from the URL, checked here for the same reason
 * (model/roadmapTime.ts reads it): a preset's key, or a span drawn in months,
 * "2025-10..2026-09", or in quarters, "2025-Q4..2026-Q3", the last one
 * counted. A span past MAX_WINDOW_MONTHS is cut to it; anything else is
 * null.
 */
export function windowParam(key: string | null | undefined): string | null {
   if (!key) return null;
   if (WINDOW_PRESET_KEYS.includes(key)) return key;
   const months = MONTHS_KEY.exec(key);
   const quarters = QUARTERS_KEY.exec(key);
   const m = months ?? quarters;
   if (!m) return null;
   // in the key's own periods: months, or quarters
   const per = months ? 12 : 4;
   const max = months ? MAX_WINDOW_MONTHS : MAX_WINDOW_MONTHS / 3;
   const a = Number(m[1]) * per + Number(m[2]) - 1;
   const b = Number(m[3]) * per + Number(m[4]) - 1;
   if (b < a) return null;
   if (b - a < max) return key;
   const last = a + max - 1;
   const index = (last % per) + 1;
   return `${m[1]}-${quarters ? 'Q' : ''}${m[2]}..${Math.floor(last / per)}-${
      quarters ? `Q${index}` : String(index).padStart(2, '0')
   }`;
}

/** The origins a roadmap filter can pick in the URL, kept here for the same
 * reason: shared/model/roadmap.ts's ROADMAP_ORIGINS, plus `unsaid` (a test
 * holds the two lists together). */
export const ORIGIN_KEYS = ['asked', 'fire', 'chosen', 'unsaid'] as const;

/** Canonical label for each lens — the single source every surface naming the
 * views reads from: the tab strip and phone dropdown (app.tsx /
 * LensMenu), saved-filter descriptions (model/savedFilters.ts), and the
 * Settings panel's lens pickers (components/Settings.tsx). One restated copy
 * (model/savedFilters.ts's old LENS_LABEL) drifted and was missing `ci`,
 * rendering a saved CI-lens filter as "ci lens" instead of "CI lens". */
export const LENS_LABELS: Record<Lens, string> = {
   review: 'Review',
   mine: 'My work',
   team: 'Team',
   projects: 'Projects',
   classic: 'Classic',
   ci: 'CI',
   stats: 'Stats',
};

/** Whether any key of a view (app.tsx's `view`) differs from the last
 * one's: each is a view change that earns a history entry, so none can be
 * left out of the comparison by accident. */
export function viewChanged<V extends object>(prev: V, view: V): boolean {
   return (Object.keys(view) as (keyof V)[]).some(k => prev[k] !== view[k]);
}
