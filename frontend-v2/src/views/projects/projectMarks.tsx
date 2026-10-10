import { dayOf, dayWords } from '../../model/projectData';

/** Every mark in a project's Progress is this wide: a fixed ruler, so one
 * project's bar reads against another's. */
export const MARK_W = 240;

// LoadChart's own: on plan, ahead on plan, off plan
const ON_PLAN = 'var(--brand)';
const ON_PLAN_AHEAD = 'color-mix(in oklab, var(--brand) 45%, transparent)';
const OFF_PLAN = 'color-mix(in oklab, var(--ink-3) 70%, transparent)';

const DAY = 86400;
const at = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
// the day as the page's words count it, so the mark and the text agree
const dayOfSecs = (secs: number) => dayOf(new Date(secs * 1000));

/**
 * A plan on one line: its start at the left, the time gone in brand, the
 * time left paler, a run past a promised end in amber (Decide owes a call)
 * or past an estimate in grey; ticks for today and the target, and the
 * forecast as a dashed line ending in a hollow ring, since it's a guess.
 * The words beside it say every date; the tooltip says them all at once.
 */
export function PlanTimeline({
   start,
   end,
   promised,
   today,
   target,
   forecast,
   parked,
   onOpen,
}: {
   start: string;
   end: string;
   /** a hard end: running past it is owed, not just drift */
   promised: boolean;
   today: string;
   target: string | null;
   /** epoch seconds */
   forecast: number | null;
   parked: boolean;
   onOpen: () => void;
}) {
   const s = at(start);
   const e = at(end) + DAY; // through the end day
   const t = at(today);
   const g = target ? at(target) + DAY : null;
   const planLen = e - s;
   // a forecast more than twice the plan away is pinned to the edge, its
   // label saying the day
   const far = forecast != null && forecast > s + 3 * planLen;
   const f = forecast == null ? null : far ? null : forecast;
   const last = Math.max(e, t, g ?? 0, f ?? 0);
   const span = (last - s) * 1.04 || 1;
   const x = (secs: number) => Math.max(0, Math.min(MARK_W, ((secs - s) / span) * MARK_W));
   const xe = x(e);
   const xt = x(t);
   const xg = g == null ? null : x(g);
   const xf = forecast == null ? null : far ? MARK_W : x(forecast);
   const gone = Math.min(xt, xe);
   const segs: { from: number; to: number; fill: string }[] = [];
   if (gone > 0) segs.push({ from: 0, to: gone, fill: parked ? OFF_PLAN : ON_PLAN });
   if (xt < xe) segs.push({ from: xt, to: xe, fill: ON_PLAN_AHEAD });
   if (xt > xe) segs.push({ from: xe, to: xt, fill: promised ? 'var(--warn)' : OFF_PLAN });
   // the labels that fit, in order of importance; one too near another
   // stays in the tooltip
   const words = (d: string) => dayWords(d);
   // past a promised end, the end is what Decide asks about, so its label
   // wins a collision; today's ink tick says "today" without words
   const endLabel = { x: xe, text: `${words(end)} end` };
   const todayLabel = { x: xt, text: 'today' };
   const candidates: { x: number; text: string }[] = [
      ...(xt > xe && promised ? [endLabel, todayLabel] : [todayLabel, endLabel]),
      ...(xg != null && target ? [{ x: xg, text: `${words(target)} target` }] : []),
      ...(xf != null && forecast != null
         ? [
              {
                 x: xf,
                 text: far ? `${words(dayOfSecs(forecast))} →` : `${words(dayOfSecs(forecast))}?`,
              },
           ]
         : []),
   ];
   // the start is the left edge, so it goes unlabeled (its day is in the title)
   const placed: { x: number; text: string }[] = [];
   for (const c of candidates) {
      if (placed.every(p => Math.abs(p.x - c.x) >= 44)) placed.push(c);
   }
   const summary = [
      `Started ${words(start)}`,
      `${promised ? 'promised' : 'estimated'} end ${words(end)}`,
      target && `target ${words(target)}`,
      `today ${words(today)}`,
      forecast != null && `issues say done around ${words(dayOfSecs(forecast))}`,
   ]
      .filter(Boolean)
      .join(', ');
   return (
      <button
         type="button"
         onClick={onOpen}
         title={`${summary}. Opens the plan on the roadmap.`}
         aria-label={`${summary}. Open the plan on the roadmap`}
         className="hit pressable relative block h-[32px] border-0 bg-transparent p-0 text-left"
         style={{ width: MARK_W }}
      >
         <svg width={MARK_W} height={20} aria-hidden className="block overflow-visible">
            {segs.map((seg, i) => {
               // a 2px surface gap where two parts meet
               const a = seg.from + (i > 0 ? 1 : 0);
               const b = seg.to - (i < segs.length - 1 ? 1 : 0);
               return (
                  <rect
                     key={i}
                     x={a}
                     y={7}
                     width={Math.max(0, b - a)}
                     height={6}
                     rx={i === 0 || i === segs.length - 1 ? 3 : 0}
                     fill={seg.fill}
                  />
               );
            })}
            {xf != null && (
               <>
                  <line
                     x1={xt}
                     x2={xf - 3}
                     y1={10}
                     y2={10}
                     stroke="var(--ink-3)"
                     strokeWidth={1}
                     strokeDasharray="2 2"
                  />
                  <circle cx={xf - 3} cy={10} r={3} fill="var(--surface)" stroke="var(--ink-3)" />
               </>
            )}
            {/* the end: a thin tick; the target: a caret above the bar, a
                shape of its own so it never reads as part of today's tick */}
            <rect x={xe - 0.5} y={4} width={1} height={12} fill="var(--ink-2)" />
            {xg != null && <path d={`M${xg - 3},0 h6 l-3,4 z`} fill="var(--ink-2)" />}
            <rect x={xt - 0.75} y={4} width={1.5} height={12} fill="var(--ink)" />
         </svg>
         {placed.map(p => (
            <span
               key={p.text}
               className="absolute top-[19px] text-[11px] leading-3 whitespace-nowrap text-ink-2 tabular-nums"
               style={
                  p.x < 24
                     ? { left: p.x }
                     : p.x > MARK_W - 24
                     ? { right: MARK_W - p.x }
                     : { left: p.x, transform: 'translateX(-50%)' }
               }
            >
               {p.text}
            </span>
         ))}
      </button>
   );
}

/**
 * Its issues as one bar on the fixed ruler: done, then dropped, then open,
 * so it fills toward finished. Each part does what its count does.
 */
export function IssuesBar({
   done,
   dropped,
   open,
   onPart,
}: {
   done: number;
   dropped: number;
   open: number;
   onPart: (part: 'done' | 'dropped' | 'open') => void;
}) {
   const total = done + dropped + open;
   if (!total) return null;
   const parts = (
      [
         ['done', done, 'var(--ok)'],
         ['dropped', dropped, 'var(--secondary)'],
         ['open', open, ON_PLAN_AHEAD],
      ] as const
   ).filter(([, n]) => n > 0);
   const room = MARK_W - 2 * (parts.length - 1);
   return (
      <span className="flex h-5 items-center gap-[2px]" style={{ width: MARK_W }}>
         {parts.map(([part, n, fill], i) => (
            <button
               key={part}
               type="button"
               onClick={() => onPart(part)}
               title={`${n} ${part}`}
               aria-label={`${n} ${part}: show them`}
               className="hit pressable flex h-3 items-center border-0 bg-transparent p-0"
               style={{ width: (n / total) * room }}
            >
               <span
                  className={`block h-1.5 w-full ${i === 0 ? 'rounded-l-full' : ''} ${
                     i === parts.length - 1 ? 'rounded-r-full' : ''
                  }`}
                  style={{ background: fill }}
               />
            </button>
         ))}
      </span>
   );
}
