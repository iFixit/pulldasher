import { ROT_DAYS, STARVE_DAYS } from '../../../shared/model/status';
import { ago } from '../../../shared/format';
import { railTriggerClass } from './bits';
import { Popover } from './Popover';

/**
 * The age popover's body: "opened X ago", "last activity Y ago", and (only
 * when the row's age line is actually drawn) the line's own relative-to-
 * the-oldest explanation. Shared by AgeStamp (the numeral, every row) and
 * AgeBaseline (the hoverable band, only aging rows) so the two doors into
 * the same fact can never drift apart — one copy, two triggers.
 */
function AgePopoverBody({
   createdAt,
   updatedAt,
   explainLine,
}: {
   /** epoch secs the pull opened */
   createdAt: number;
   /** epoch secs of the last activity */
   updatedAt: number;
   /** the caller decides: the numeral shows on every row and only adds this
    * once its own age crosses warnDays, the band only ever renders once
    * that's already true, so it always passes it. */
   explainLine: boolean;
}) {
   return (
      <>
         <span className="block px-1 text-ink-2">
            opened <b className="font-medium text-ink">{ago(createdAt)} ago</b>
         </span>
         <span className="mt-0.5 block px-1 text-ink-2">
            last activity <b className="font-medium text-ink">{ago(updatedAt)} ago</b>
         </span>
         {explainLine && (
            <span className="mt-0.5 block max-w-[220px] px-1 whitespace-normal text-ink-3">
               the grey line under this row is its age, relative to the board’s oldest open pull
            </span>
         )}
      </>
   );
}

/**
 * Age as the row's own baseline: a 1px hairline along the bottom edge — a
 * tinted stretch of the divider the row already has, not a drawn bar.
 * RELATIVE, not thresholded: the board's longest-open pull sets the full
 * track and every row is a fraction of it, so the line answers "how long
 * has this waited, relative to what waiting looks like here." The tint
 * deepens with that same fraction, ultra-light ink for the merely-aging
 * through full ink-3 for the oldest — age is a quiet fact in grey, never
 * a colored alarm (an amber version shipped for an hour and was the
 * loudest thing on the board; urgency belongs to the queue's ranking and
 * the numeral's weight). Silent below the aging threshold — a healthy
 * young row draws nothing.
 *
 * The line is also a door now, not pure geometry: a 10px invisible hit strip
 * (`.pd-age-track`/`.pd-age-hit` in styles.css), sized to the SAME fraction
 * as the visible line so a 1px target doesn't need pixel-hunting, opens the
 * same age popover the numeral shows on hover or focus and grows the line to
 * an 8px band while it's open. At rest it's pixel-identical to the old
 * static hairline.
 */
export function AgeBaseline({
   ageDays,
   createdAt,
   updatedAt,
   warnDays = STARVE_DAYS,
   maxAgeDays = 1,
   quiet,
}: {
   ageDays: number;
   /** epoch secs the pull opened — feeds the shared age popover body */
   createdAt: number;
   /** epoch secs of the last activity — feeds the shared age popover body */
   updatedAt: number;
   warnDays?: number;
   /** the board's longest-open pull — the 100% mark of the track */
   maxAgeDays?: number;
   /** drafts and holds age on purpose: draw nothing */
   quiet?: boolean;
}) {
   if (quiet || ageDays < warnDays) return null;
   const t = Math.min(ageDays / Math.max(maxAgeDays, 1), 1);
   // tint rides the same fraction as length: ~30% border-grey at the
   // gate, the full border color on the board's oldest (owner call: the
   // ink ramp read too dark against the row divider it extends)
   const inkPct = Math.round(30 + 70 * t);
   return (
      // the percentage width lives on this outer track (not the line itself,
      // see styles.css): the line and its taller hit area both fill 100% of
      // it, so hovering anywhere along the row's actual age fraction — never
      // past it — opens the door.
      <span className="pd-age-track" style={{ width: `${(t * 100).toFixed(1)}%` }}>
         <Popover
            label="Age"
            side="left"
            hover
            rootClass="block h-full w-full"
            width="w-max"
            panelClass="p-2 text-xs whitespace-nowrap"
            trigger={t2 => (
               <button
                  {...t2}
                  type="button"
                  aria-label={`age: opened ${ago(createdAt)} ago`}
                  // pd-age-hit: the hover/focus hook that grows .pd-age-line
                  // (styles.css) — border/bg reset only, no positioning of its
                  // own, since the track above already placed this box.
                  className="pd-age-hit block h-full w-full border-0 bg-transparent p-0"
               >
                  <span
                     aria-hidden
                     className="pd-age-line"
                     style={{
                        background: `color-mix(in oklab, var(--border) ${inkPct}%, transparent)`,
                     }}
                  />
               </button>
            )}
         >
            <AgePopoverBody createdAt={createdAt} updatedAt={updatedAt} explainLine />
         </Popover>
      </span>
   );
}

/**
 * The age slot: hours under a day, then days, with both clocks in the
 * popover. Hours matter here: in three months of real history, 62% of
 * pulls merged same-day, so "0d" was a dead signal for most of the live
 * board. It rides at the rail's far right, capping the row — and it
 * WHISPERS: its resting color is the age line's own border tint, rising to
 * ink on row hover (see styles.css .pd-age-num). Age's salience is carried
 * once, by the baseline built for continuous gradation; the numeral is the
 * label you consult, not a second alarm. Font weight still steps at the
 * warn/rot thresholds so the hover read carries the urgency.
 *
 * `display` picks the clock the numeral shows (opened vs last update); the
 * urgency weight always follows the OPENED clock — how long a pull has been
 * open is the truth the board ranks by, whichever number the user prefers
 * to read.
 */
export function AgeStamp({
   ageDays,
   createdAt,
   updatedAt,
   quiet,
   warnDays = STARVE_DAYS,
   rotDays = ROT_DAYS,
   inline,
   display = 'opened',
}: {
   ageDays: number;
   /** epoch secs the pull opened */
   createdAt: number;
   /** epoch secs of the last activity */
   updatedAt: number;
   /** drafts and holds age on purpose: no urgency weight */
   quiet?: boolean;
   /** heavier type at/after this many days (user setting; defaults to the model's) */
   warnDays?: number;
   /** heaviest type at/after this many days */
   rotDays?: number;
   /** true when it's embedded in a flowing meta line rather than the rail's
    * fixed-width column — drops the w-7/text-right slot in favor of plain
    * inline text. */
   inline?: boolean;
   /** which clock the numeral shows (settings.ageDisplay) */
   display?: 'opened' | 'updated';
}) {
   const heft = quiet
      ? ''
      : ageDays >= rotDays
        ? 'font-semibold'
        : ageDays >= warnDays
          ? 'font-medium'
          : '';
   const shownEpoch = display === 'updated' ? updatedAt : createdAt;
   const shownDays =
      display === 'updated'
         ? Math.max(0, Math.floor((Date.now() / 1000 - updatedAt) / 86400))
         : ageDays;
   const text = shownDays === 0 ? ago(shownEpoch) : `${shownDays}d`;
   // a popover, not a title: the second clock (last activity) exists nowhere
   // else on the row, and a native tooltip is mouse-only — this way touch
   // taps it and keyboard reads it from the aria-label
   return (
      <Popover
         label="Age"
         side="right"
         hover
         rootClass="relative inline-flex"
         width="w-max"
         panelClass="p-2 text-xs whitespace-nowrap"
         trigger={t => (
            <button
               {...t}
               type="button"
               aria-label={`opened ${ago(createdAt)} ago, last activity ${ago(updatedAt)} ago`}
               className={`px-0 text-inherit ${railTriggerClass}`}
            >
               <span
                  aria-hidden
                  className={`pd-age-num tabular-nums ${inline ? '' : 'block w-7 text-right'} ${heft}`}
               >
                  {text}
               </span>
            </button>
         )}
      >
         <AgePopoverBody
            createdAt={createdAt}
            updatedAt={updatedAt}
            explainLine={!quiet && ageDays >= warnDays}
         />
      </Popover>
   );
}
