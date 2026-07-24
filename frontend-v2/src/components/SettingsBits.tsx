import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { textInputClass } from './bits';
import { Icon } from './Icon';

/** A labelled group of controls inside a settings surface (the Settings panel
 * or the bell's nudge-settings view) — one definition so both render the
 * section chrome identically. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
   return (
      <section className="border-t border-secondary px-4 py-2.5 first:border-t-0">
         <h3 className="m-0 mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">
            {title}
         </h3>
         <div className="flex flex-col gap-2.5">{children}</div>
      </section>
   );
}

/** One setting: a label (+ optional hint) over its control. */
export function Field({
   label,
   hint,
   children,
}: {
   label: string;
   hint?: string;
   children: ReactNode;
}) {
   return (
      <div className="flex flex-col gap-1">
         <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium text-ink">{label}</span>
            {children}
         </div>
         {hint && <span className="text-xs text-ink-3">{hint}</span>}
      </div>
   );
}

/** A collapsible "how it works" note, so the same disclosure look and feel
 * shows up in the Settings panel and the bell's nudge-settings view. Closed
 * by default: it's there when you go looking, not in the way when you aren't. */
export function Explainer({ summary, children }: { summary: string; children: ReactNode }) {
   return (
      <details className="group/exp -mt-1">
         <summary className="flex cursor-pointer list-none items-center gap-1 py-0.5 text-xs font-medium text-ink-3 hover:text-ink-2">
            <Icon icon={ChevronRight} className="transition-transform group-open/exp:rotate-90" />
            {summary}
         </summary>
         <div className="space-y-1.5 pt-1 pb-0.5 pl-3 text-xs text-ink-2">{children}</div>
      </details>
   );
}

/** A small bounded number stepper (days, seconds). */
export function NumberField({
   value,
   min,
   max,
   suffix,
   onChange,
}: {
   value: number;
   min: number;
   max: number;
   suffix: string;
   onChange: (next: number) => void;
}) {
   return (
      <span className="inline-flex items-center gap-1.5">
         <input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={e => {
               const n = Number(e.target.value);
               if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
            }}
            className={`w-16 px-2 text-right tabular-nums ${textInputClass}`}
         />
         <span className="text-xs text-ink-3">{suffix}</span>
      </span>
   );
}
