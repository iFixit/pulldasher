import { useState, type CSSProperties } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
// eslint-import-resolver-node can't follow exports-only paths (the same
// reason vite.config.ts disables this for @tailwindcss/vite); Vite resolves it.
// eslint-disable-next-line import/no-unresolved
import 'react-day-picker/style.css';
import { PrimaryButton } from '../../components/bits';
import {
   dateOf,
   dayOf,
   MAX_RANGE_DAYS,
   rangeDays,
   rangeWords,
   type Range,
} from '../../model/projectData';

/**
 * The first month a calendar of `months` months opens on. Its last month
 * holds the range's end, or the day two weeks ago when that's earlier, so a
 * calendar opened early in a month shows days that can be picked rather
 * than a month still mostly to come. The arrows reach this month.
 */
export function openingMonth(end: Date, today: Date, months: number): Date {
   const twoWeeksAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14);
   const last = end < twoWeeksAgo ? end : twoWeeksAgo;
   return new Date(last.getFullYear(), last.getMonth() - (months - 1), 1);
}

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
 * Two months of calendar for picking a range by hand (one on a phone, so the
 * panel and its Apply fit the screen): click the first day, then the last,
 * then Apply. Clicking again starts a new range. Days after today can't be
 * picked, and a range stops at the server's 400-day cap. Weeks start on
 * Monday, as the charts' weeks do. Loaded lazily with the picker's panel,
 * stylesheet included.
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
   // read once: the panel mounts afresh each time it opens
   const [months] = useState(() => (matchMedia('(min-width: 640px)').matches ? 2 : 1));
   const today = new Date();
   const picked =
      draft?.from && draft.to ? { start: dayOf(draft.from), end: dayOf(draft.to) } : null;
   return (
      <div className="flex flex-col gap-2">
         <DayPicker
            mode="range"
            selected={draft}
            onSelect={setDraft}
            resetOnSelect
            weekStartsOn={1}
            max={MAX_RANGE_DAYS}
            numberOfMonths={months}
            defaultMonth={openingMonth(dateOf(range.end), today, months)}
            endMonth={today}
            disabled={{ after: today }}
            style={CALENDAR_VARS}
            className="pd-calendar text-[13px] text-ink"
         />
         <div className="flex items-center gap-3 border-t border-secondary pt-2 text-xs text-ink-3">
            <span className="tabular-nums">
               {picked
                  ? `${rangeWords(picked)} · ${rangeDays(picked)} days`
                  : `Click the first day, then the last (at most ${MAX_RANGE_DAYS} days)`}
            </span>
            <span className="flex-1" />
            <PrimaryButton
               type="button"
               disabled={!picked}
               onClick={() => picked && onApply(picked)}
            >
               Apply
            </PrimaryButton>
         </div>
      </div>
   );
}
