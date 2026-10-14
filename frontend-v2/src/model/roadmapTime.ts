import { endOf, type RoadmapItem } from '../../../shared/model/roadmap';
import { WINDOW_KEY, ZOOM_KEY } from '../lens';
import { dateOf, dayOf } from './days';

/**
 * The roadmap timeline's columns: four quarters or seven months across, or,
 * zoomed in, one quarter's months or one month's weeks filling the width.
 * A zoom is kept in the URL as its key, "2026-Q4" or "2026-10".
 */

export interface Column {
   start: string;
   /** the first day after it */
   end: string;
   label: string;
   /** the zoom key that fills the width with this column; null at the finest */
   zoom: string | null;
}

export interface Zoom {
   kind: 'quarter' | 'month';
   year: number;
   /** the quarter (0 to 3) or the month (0 to 11) */
   index: number;
}

export function parseZoom(key: string | null | undefined): Zoom | null {
   const m = key ? ZOOM_KEY.exec(key) : null;
   if (!m) return null;
   return m[2]
      ? { kind: 'quarter', year: Number(m[1]), index: Number(m[2]) - 1 }
      : { kind: 'month', year: Number(m[1]), index: Number(m[3]) - 1 };
}

export function zoomKey(z: Zoom): string {
   return z.kind === 'quarter'
      ? `${z.year}-Q${z.index + 1}`
      : `${z.year}-${String(z.index + 1).padStart(2, '0')}`;
}

/** The same kind of period, `by` of them later (earlier when negative). */
export function shiftZoom(z: Zoom, by: number): Zoom {
   const per = z.kind === 'quarter' ? 4 : 12;
   const at = z.year * per + z.index + by;
   return { kind: z.kind, year: Math.floor(at / per), index: ((at % per) + per) % per };
}

/** The quarter or month a day falls in. */
export function zoomAround(kind: Zoom['kind'], day: Date): Zoom {
   const month = day.getMonth();
   return {
      kind,
      year: day.getFullYear(),
      index: kind === 'quarter' ? Math.floor(month / 3) : month,
   };
}

/** The quarter a zoomed month is in. */
export function quarterOf(z: Zoom): Zoom {
   return z.kind === 'quarter'
      ? z
      : { kind: 'quarter', year: z.year, index: Math.floor(z.index / 3) };
}

const firstDay = (z: Zoom) => new Date(z.year, z.kind === 'quarter' ? z.index * 3 : z.index, 1);

export function zoomWords(z: Zoom): string {
   return z.kind === 'quarter'
      ? `Q${z.index + 1} ${z.year}`
      : firstDay(z).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function columnsFor(
   scale: Scale,
   zoom: Zoom | null,
   now: Date,
   picked: Months | null = null
): Column[] {
   if (zoom?.kind === 'quarter') {
      const first = firstDay(zoom);
      return [0, 1, 2].map(i => {
         const a = new Date(first.getFullYear(), first.getMonth() + i, 1);
         return {
            start: dayOf(a),
            end: dayOf(new Date(a.getFullYear(), a.getMonth() + 1, 1)),
            label: a.toLocaleDateString(undefined, { month: 'long' }),
            zoom: monthKey(a),
         };
      });
   }
   if (zoom?.kind === 'month') {
      // its weeks, cut at the month's edges: the 1st to its Sunday, then
      // Monday to Sunday, the last one ending with the month
      const first = firstDay(zoom);
      const end = new Date(first.getFullYear(), first.getMonth() + 1, 1);
      const columns: Column[] = [];
      for (let a = first; a < end; ) {
         const toMonday = (8 - a.getDay()) % 7 || 7;
         const monday = new Date(a.getFullYear(), a.getMonth(), a.getDate() + toMonday);
         const b = monday < end ? monday : end;
         columns.push({
            start: dayOf(a),
            end: dayOf(b),
            label: a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            zoom: null,
         });
         a = b;
      }
      return columns;
   }
   const { months: w, unit } = drawnWindow(scale, picked, now);
   if (unit === 'month') {
      return Array.from({ length: w.to - w.from }, (_, i) => {
         const a = monthDate(w.from + i);
         return {
            start: dayOf(a),
            end: dayOf(monthDate(w.from + i + 1)),
            label: a.toLocaleDateString(undefined, {
               month: 'short',
               year: i === 0 || a.getMonth() === 0 ? 'numeric' : undefined,
            }),
            zoom: monthKey(a),
         };
      });
   }
   return Array.from({ length: (w.to - w.from) / 3 }, (_, i) => {
      const a = monthDate(w.from + i * 3);
      const quarter = Math.floor(a.getMonth() / 3) + 1;
      return {
         start: dayOf(a),
         end: dayOf(monthDate(w.from + i * 3 + 3)),
         label: `Q${quarter} ${a.getFullYear()}`,
         zoom: `${a.getFullYear()}-Q${quarter}`,
      };
   });
}

export type Scale = 'month' | 'quarter';

/**
 * The roadmap's window, in whole months counted from year 0 (year × 12 +
 * month), `to` the first month after it. Picked in the date range picker; in
 * the URL as a preset's key ("ytd"), or as its months, "2025-10..2026-09",
 * the last one counted. None picked is the default: last quarter and the
 * next three, or at Months, last month and the next six.
 */
export interface Months {
   from: number;
   to: number;
}

const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();
const monthDate = (i: number) => new Date(Math.floor(i / 12), i % 12, 1);
const monthText = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

/** The picker's presets, in its order; Custom is the calendar beside them. */
export const WINDOW_PRESETS: [string, string][] = [
   ['quarter', 'This quarter'],
   ['2q', 'Next 2 quarters'],
   ['6m', 'Next 6 months'],
   ['ytd', 'Year to date'],
   ['12m', 'Last 12 months'],
   ['year', 'This year'],
];

/** A window key's months as of `now`; null for none or a key that isn't one. */
export function resolveWindow(key: string | null | undefined, now: Date): Months | null {
   if (!key || !WINDOW_KEY.test(key)) return null;
   const m = monthIndex(now);
   const q = m - (m % 3);
   const jan = m - now.getMonth();
   switch (key) {
      case 'quarter':
         return { from: q, to: q + 3 };
      case '2q':
         return { from: q, to: q + 6 };
      case '6m':
         return { from: m, to: m + 6 };
      case 'ytd':
         return { from: jan, to: m + 1 };
      case '12m':
         return { from: m - 11, to: m + 1 };
      case 'year':
         return { from: jan, to: jan + 12 };
   }
   const [a, b] = key.split('..').map(t => Number(t.slice(0, 4)) * 12 + Number(t.slice(5)) - 1);
   return a <= b ? { from: a, to: b + 1 } : null;
}

/** A window's key: its first and last months, "2025-10..2026-09". */
export function windowKey(w: Months): string {
   return `${monthText(w.from)}..${monthText(w.to - 1)}`;
}

/** The months of the first day through the last day picked on a calendar. */
export function windowOfDays(start: string, end: string): Months {
   return { from: monthIndex(dateOf(start)), to: monthIndex(dateOf(end)) + 1 };
}

/** The window people land on, as before there was a picker. */
export function defaultWindow(scale: Scale, now: Date): Months {
   const m = monthIndex(now);
   const q = m - (m % 3);
   return scale === 'month' ? { from: m - 1, to: m + 6 } : { from: q - 3, to: q + 9 };
}

/**
 * The columns a window is drawn in, from its length: months up to four
 * months, and up to a year that doesn't fall on whole quarters (year to
 * date, the last 12 months), so it's drawn as picked; quarters past that, or
 * when it's whole quarters anyway.
 */
export function windowUnit(w: Months): Scale {
   const length = w.to - w.from;
   const quarters = w.from % 3 === 0 && length % 3 === 0;
   return length <= 4 || (length <= 12 && !quarters) ? 'month' : 'quarter';
}

/** The window drawn: the one picked, out to whole quarters when it's drawn
 * in quarters, or the default at `scale`; and its columns' unit. */
export function drawnWindow(
   scale: Scale,
   picked: Months | null,
   now: Date
): { months: Months; unit: Scale } {
   if (!picked) return { months: defaultWindow(scale, now), unit: scale };
   const unit = windowUnit(picked);
   return {
      months:
         unit === 'quarter'
            ? { from: picked.from - (picked.from % 3), to: picked.to + ((3 - (picked.to % 3)) % 3) }
            : picked,
      unit,
   };
}

/** The window `by` of its own lengths later (earlier when negative). */
export function shiftWindow(w: Months, by: number): Months {
   const length = w.to - w.from;
   return { from: w.from + by * length, to: w.to + by * length };
}

/**
 * A window of the same length holding a day: the same one when it already
 * does, else one starting at the day's month (its quarter, drawn in
 * quarters). Where the edge chip and zooming out land.
 */
export function windowHolding(w: Months, day: string, unit: Scale): Months {
   const m = monthIndex(dateOf(day));
   if (m >= w.from && m < w.to) return w;
   const from = unit === 'quarter' ? m - (m % 3) : m;
   return { from, to: from + w.to - w.from };
}

/** "Jan to Oct 2026", "Q4 2025 to Q3 2026", "Oct 2026": what the window
 * covers, in its columns' unit. */
export function windowWords(w: Months, unit: Scale): string {
   const year = (i: number) => Math.floor(i / 12);
   const word = (i: number, withYear: boolean) => {
      const y = withYear ? ` ${year(i)}` : '';
      return unit === 'quarter'
         ? `Q${Math.floor((i % 12) / 3) + 1}${y}`
         : `${monthDate(i).toLocaleDateString(undefined, { month: 'short' })}${y}`;
   };
   const last = unit === 'quarter' ? w.to - 3 : w.to - 1;
   if (last <= w.from) return word(w.from, true);
   return `${word(w.from, year(w.from) !== year(last))} to ${word(last, true)}`;
}

/** The done plans whose last week is before a window's first day: they
 * rest in one fold under the rows instead of each taking a row. */
export function doneBefore<T extends Pick<RoadmapItem, 'status' | 'start' | 'weeks' | 'end_kind'>>(
   plans: readonly T[],
   start: string
): T[] {
   return plans.filter(i => {
      const end = i.status === 'done' && endOf(i);
      return !!end && end < start;
   });
}

/** An end a plan can commit to. */
export interface CommitEnd {
   /** its words on a button: "End of Oct", "Its target date, Oct 21" */
   label: string;
   /** the day it runs through, YYYY-MM-DD */
   end: string;
   /** its words after "by" in a sentence: "the end of Oct", "its target
    * date, Oct 21" */
   through: string;
   /** the project's own target, not a month's or a quarter's end */
   target?: boolean;
}

/**
 * The ends of the coming months and quarters a plan can commit to: the next
 * two of each that are at least a week out, so a commitment is never to a
 * period that is all but over, in date order. Their labels are the tab's one
 * set of words for them, in Decide's calls and the roadmap's chooser and
 * editor: "End of Oct", "End of Q4", with the year whenever it isn't this
 * one ("End of Q1 2027"). A project's `target` (its issue's Target date or
 * its milestone's due day) comes first while it's still ahead, however
 * near: "Its target date, Oct 21", in place of a month or quarter ending
 * the same day. A target already passed is a miss, not an end to offer.
 */
export function commitEnds(today: string, target?: string | null): CommitEnd[] {
   const t = dateOf(today);
   const soon = dayOf(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 7));
   const year = (last: Date) =>
      last.getFullYear() === t.getFullYear() ? '' : ` ${last.getFullYear()}`;
   const ends = (months: number, label: (last: Date) => string) => {
      const out: CommitEnd[] = [];
      const first = Math.floor(t.getMonth() / months) * months;
      for (let k = 1; out.length < 2; k++) {
         const last = new Date(t.getFullYear(), first + k * months, 0);
         const words = label(last);
         // "End of Q4" reads "the end of Q4"
         const through = `the ${words.replace(/^End/, 'end')}`;
         if (dayOf(last) >= soon) out.push({ label: words, end: dayOf(last), through });
      }
      return out;
   };
   // a month that ends a quarter goes by the quarter's name
   const byEnd = new Map(
      [
         ...ends(
            1,
            last => `End of ${last.toLocaleDateString(undefined, { month: 'short' })}${year(last)}`
         ),
         ...ends(3, last => `End of Q${Math.floor(last.getMonth() / 3) + 1}${year(last)}`),
      ].map(c => [c.end, c])
   );
   const sorted = [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
   if (!target || target < today) return sorted;
   const due = dateOf(target);
   // "Oct 21", with its year in another one, as the ends say theirs
   const day = due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + year(due);
   return [
      {
         label: `Its target date, ${day}`,
         end: target,
         through: `its target date, ${day}`,
         target: true,
      },
      ...sorted.filter(c => c.end !== target),
   ];
}
