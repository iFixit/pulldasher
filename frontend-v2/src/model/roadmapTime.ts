import { ZOOM_KEY } from '../lens';
import { dateOf, dayOf } from './days';

/**
 * The roadmap timeline's columns: six quarters or seven months across, or,
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

export function columnsFor(scale: 'month' | 'quarter', zoom: Zoom | null, now: Date): Column[] {
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
   const y = now.getFullYear();
   const m = now.getMonth();
   if (scale === 'month') {
      // seven months from last month, so a little of the past sits beside the plan
      return Array.from({ length: 7 }, (_, i) => {
         const a = new Date(y, m - 1 + i, 1);
         return {
            start: dayOf(a),
            end: dayOf(new Date(y, m + i, 1)),
            label: a.toLocaleDateString(undefined, {
               month: 'short',
               year: i === 0 || a.getMonth() === 0 ? 'numeric' : undefined,
            }),
            zoom: monthKey(a),
         };
      });
   }
   // six quarters from last quarter
   const q = Math.floor(m / 3) * 3;
   return Array.from({ length: 6 }, (_, i) => {
      const a = new Date(y, q - 3 + i * 3, 1);
      const quarter = Math.floor(a.getMonth() / 3) + 1;
      return {
         start: dayOf(a),
         end: dayOf(new Date(y, q + i * 3, 1)),
         label: `Q${quarter} ${a.getFullYear()}`,
         zoom: `${a.getFullYear()}-Q${quarter}`,
      };
   });
}

/**
 * The ends of the coming months and quarters a plan can commit to: the next
 * two of each that are at least a week out, so a commitment is never to a
 * period that is all but over, in date order. Their labels are the tab's one
 * set of words for them, in Decide's calls and the roadmap's chooser and
 * editor: "End of Oct", "End of Q4", with the year whenever it isn't this
 * one ("End of Q1 2027").
 */
export function commitEnds(today: string): { label: string; end: string }[] {
   const t = dateOf(today);
   const soon = dayOf(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 7));
   const year = (last: Date) =>
      last.getFullYear() === t.getFullYear() ? '' : ` ${last.getFullYear()}`;
   const ends = (months: number, label: (last: Date) => string) => {
      const out: { label: string; end: string }[] = [];
      const first = Math.floor(t.getMonth() / months) * months;
      for (let k = 1; out.length < 2; k++) {
         const last = new Date(t.getFullYear(), first + k * months, 0);
         if (dayOf(last) >= soon) out.push({ label: label(last), end: dayOf(last) });
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
   return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}
