import { lazy, Suspense, useEffect, useId, useState, type KeyboardEvent } from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { Popover } from '../../components/Popover';
import { RANGE_PRESETS, rangeName, rangeWords, type Range } from '../../model/projectData';

// the calendar and its stylesheet load the first time the panel opens
const RangeCalendar = lazy(() => import('./RangeCalendar'));

/**
 * The date range control, shaped like the one in any analytics tool: one
 * button that names the range and its days, opening the presets beside a
 * two-month calendar. A preset applies on click; a range picked on the
 * calendar applies with Apply. A custom range's button says its dates, even
 * on a phone, where "Custom range" alone would say nothing.
 */
export function DateRangePicker({
   rangeKey,
   range,
   onChange,
}: {
   rangeKey: string;
   range: Range;
   onChange: (key: string) => void;
}) {
   // remounting the Popover is how a pick closes it (LensMenu does the same):
   // its children get no close callback
   const [picks, setPicks] = useState(0);
   const pick = (key: string) => {
      onChange(key);
      setPicks(p => p + 1);
   };
   // the remount takes the focused preset or Apply with it: hand focus back
   // to the button, which now names the range just picked
   const id = useId();
   useEffect(() => {
      if (picks) document.getElementById(id)?.focus();
   }, [picks, id]);
   // the panel sits at the end of the page, so a Tab past its last control
   // (or Shift+Tab before its first) would wander off to whatever the page
   // ends with and leave it open: it closes instead, back on the button
   const tabOut = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Tab') return;
      const stops = [
         ...e.currentTarget.querySelectorAll<HTMLElement>('button, input, [tabindex]'),
      ].filter(el => el.tabIndex >= 0 && !el.matches(':disabled'));
      if (e.target !== (e.shiftKey ? stops[0] : stops.at(-1))) return;
      e.preventDefault();
      setPicks(p => p + 1);
   };
   const custom = !RANGE_PRESETS.some(([key]) => key === rangeKey);
   return (
      <Popover
         key={picks}
         label="Pick a date range"
         width="w-[min(680px,calc(100vw-16px))]"
         panelClass="p-2"
         trigger={t => (
            <button
               {...t}
               id={id}
               type="button"
               className="pressable inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink hover:border-ring"
            >
               <Icon icon={CalendarDays} size={14} className="text-ink-3" />
               {custom ? (
                  <span className="font-medium tabular-nums">{rangeWords(range)}</span>
               ) : (
                  <>
                     <span className="font-medium">{rangeName(rangeKey)}</span>
                     <span className="hidden text-ink-3 tabular-nums sm:inline">
                        {/* the comma is for the ear: "Last 30 days, Sep 2 to Oct 1" */}
                        <span className="sr-only">, </span>
                        {rangeWords(range)}
                     </span>
                  </>
               )}
               <Icon icon={ChevronDown} size={12} className="text-ink-3" />
            </button>
         )}
      >
         <div className="flex flex-col gap-2 sm:flex-row" onKeyDown={tabOut}>
            <ul className="m-0 flex list-none flex-row flex-wrap gap-0.5 p-0 sm:w-[140px] sm:flex-none sm:flex-col">
               {RANGE_PRESETS.map(([key, label]) => (
                  <li key={key}>
                     <button
                        type="button"
                        aria-current={rangeKey === key ? 'true' : undefined}
                        onClick={() => pick(key)}
                        className={`pressable flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] whitespace-nowrap ${
                           rangeKey === key
                              ? 'bg-secondary text-ink'
                              : 'text-ink-2 hover:text-brand'
                        }`}
                     >
                        {label}
                        {rangeKey === key && <Icon icon={Check} size={14} />}
                     </button>
                  </li>
               ))}
            </ul>
            <div className="min-w-0 flex-1 border-t border-secondary pt-2 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3">
               <Suspense fallback={<div className="h-[300px]" aria-hidden />}>
                  <RangeCalendar range={range} onApply={r => pick(`${r.start}..${r.end}`)} />
               </Suspense>
            </div>
         </div>
      </Popover>
   );
}
