import { useState, type CSSProperties } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
// eslint-import-resolver-node can't follow exports-only paths (the same
// reason vite.config.ts disables this for @tailwindcss/vite); Vite resolves it.
// eslint-disable-next-line import/no-unresolved
import 'react-day-picker/style.css';
import {
   dateOf,
   dayOf,
   MAX_RANGE_DAYS,
   rangeDays,
   rangeWords,
   type Range,
} from '../../model/projectData';

// DayPicker styles itself through these variables; point them at the
// board's tokens so the calendar matches both themes without its own CSS
const CALENDAR_VARS = {
   '--rdp-accent-color': 'var(--brand)',
   '--rdp-accent-background-color': 'var(--brand-50)',
   '--rdp-range_start-color': 'var(--surface)',
   '--rdp-range_end-color': 'var(--surface)',
   '--rdp-today-color': 'var(--brand)',
   '--rdp-day-height': '32px',
   '--rdp-day-width': '32px',
   '--rdp-day_button-height': '30px',
   '--rdp-day_button-width': '30px',
   '--rdp-day_button-border-radius': '8px',
   '--rdp-nav-height': '2rem',
   '--rdp-nav_button-height': '1.75rem',
   '--rdp-nav_button-width': '1.75rem',
   '--rdp-months-gap': '1.25rem',
} as CSSProperties;

/**
 * Two months of calendar for picking a range by hand: click the first day,
 * then the last, then Apply. Clicking again starts a new range. Days after
 * today can't be picked, and a range stops at the server's 400-day cap.
 * Loaded lazily with the picker's panel, stylesheet included.
 */
export default function RangeCalendar({
   range,
   onApply,
}: {
   range: Range;
   onApply: (picked: Range) => void;
}) {
   const [draft, setDraft] = useState<DateRange | undefined>({
      from: dateOf(range.start),
      to: dateOf(range.end),
   });
   const today = new Date();
   const end = dateOf(range.end);
   const picked =
      draft?.from && draft.to ? { start: dayOf(draft.from), end: dayOf(draft.to) } : null;
   return (
      <div className="flex flex-col gap-2">
         <DayPicker
            mode="range"
            selected={draft}
            onSelect={setDraft}
            resetOnSelect
            max={MAX_RANGE_DAYS}
            numberOfMonths={2}
            defaultMonth={new Date(end.getFullYear(), end.getMonth() - 1, 1)}
            endMonth={today}
            disabled={{ after: today }}
            style={CALENDAR_VARS}
            className="pd-calendar text-[13px] text-ink"
         />
         <div className="flex items-center gap-3 border-t border-secondary pt-2 text-xs text-ink-3">
            <span className="tabular-nums">
               {picked
                  ? `${rangeWords(picked)} · ${rangeDays(picked)} days`
                  : 'Click the first day, then the last'}
            </span>
            <span className="flex-1" />
            <button
               type="button"
               disabled={!picked}
               onClick={() => picked && onApply(picked)}
               className="pressable rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-surface hover:bg-brand-700 disabled:opacity-40"
            >
               Apply
            </button>
         </div>
      </div>
   );
}
