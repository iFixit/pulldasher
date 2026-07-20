import type { ReactNode } from 'react';
import { useSettings } from '../settings';
import { FreshTag, WeightMeter } from './bits';
import { Popover } from './Popover';

/** a keycap, sized to the legend's small type */
function Kbd({ children }: { children: ReactNode }) {
   return (
      <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line bg-muted px-1 font-sans text-[11px] font-semibold text-ink-2">
         {children}
      </kbd>
   );
}

/**
 * One term/definition row. The term column is right-aligned and wraps within
 * its own width — a wide sample (two chips, a long flag) folds to a second
 * line inside the column instead of overflowing into the definition.
 */
function Item({ term, def }: { term: ReactNode; def: ReactNode }) {
   return (
      <div className="flex items-baseline gap-2.5 px-1 py-1">
         <span className="flex w-[88px] flex-none flex-wrap items-center justify-end gap-x-1 gap-y-0.5">
            {term}
         </span>
         <span className="min-w-0 flex-1 text-ink-2">{def}</span>
      </div>
   );
}

/** a labeled band of the key; every band after the first draws a hairline */
function Group({ title, children }: { title: string; children: ReactNode }) {
   return (
      <div className="mt-1.5 border-t border-secondary pt-1.5 first:mt-0 first:border-t-0 first:pt-0">
         <div className="px-1 pb-0.5 text-[10px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
            {title}
         </div>
         {children}
      </div>
   );
}

/**
 * The one-stop decoder for the board's invented vocabulary. New hires can't
 * learn "stamp" or the slashed pip from hover titles alone — this is the
 * visible answer the review pass found missing. Grouped so it reads as a
 * key, not a glossary dump: sign-offs, then the row anatomy, then badges,
 * then catching up, then keys.
 */
export function Legend() {
   const s = useSettings();

   return (
      <Popover
         label="Symbol legend"
         side="right"
         width="w-[380px]"
         panelClass="max-h-[85vh] overflow-auto p-3 text-xs"
         trigger={t => (
            <button
               {...t}
               type="button"
               aria-label="what the symbols mean"
               title="what the symbols mean"
               className="pressable inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-[13px] font-semibold text-ink-3 hover:text-brand"
            >
               ?
            </button>
         )}
      >
         <span className="block px-1 pb-1.5 text-[13px] font-semibold text-ink">
            Reading the board
         </span>

         <Group title="Sign-offs">
            <Item
               term={<b className="font-semibold text-ink">stamp</b>}
               def="a CR or QA sign-off, left as a comment on the PR"
            />
            <Item
               term={
                  <span className="inline-flex items-center gap-1">
                     <span className="text-[11px] font-medium text-ink-3">CR</span>
                     <span className="pip pip-on" />
                     <span className="pip pip-off" />
                  </span>
               }
               def="one pip per required stamp: filled = done, hollow = still needed. Click a row’s pips for who signed"
            />
            <Item
               term={
                  <span className="inline-flex items-center gap-1">
                     <span className="pip pip-on" />
                     <span className="pip pip-stale" />
                  </span>
               }
               def="an amber pip is a stamp a push invalidated: a re-stamp is owed"
            />
            <Item
               term={
                  <span className="pip-mine inline-flex items-center gap-1">
                     <span className="pip pip-on" />
                  </span>
               }
               def="the dotted underline marks a slot you stamped"
            />
            <Item
               term={<span className="text-ink-2 italic">is QAing</span>}
               def="someone claimed QA by adding the QAing label on GitHub"
            />
         </Group>

         <Group title="Reading a row">
            <Item
               term={
                  <span className="tabular-nums">
                     <b style={{ color: 'var(--warn)' }}>{s.ageWarnDays}d</b>
                     <span className="text-ink-3">/</span>
                     <b style={{ color: 'var(--bad)' }}>{s.ageRotDays}d</b>
                  </span>
               }
               def={`age: hours under a day, amber past ${s.ageWarnDays} days, red past ${s.ageRotDays}. Hover or tap it for both clocks`}
            />
            <Item
               term={<WeightMeter weight="M" />}
               def="review effort, light to heavy, from diff size"
            />
            <Item
               term={
                  <span className="tabular-nums">
                     <span style={{ color: 'var(--ok)' }}>+120</span>{' '}
                     <span style={{ color: 'var(--bad)' }}>−30</span>
                  </span>
               }
               def="lines added and removed"
            />
            <Item
               term={
                  <>
                     <span className="flag-warn">conflicts</span>
                     <span className="flag-note">stacked</span>
                  </>
               }
               def="row flags: amber = act on it (conflicts, deploy block, external, aging), gray = a neutral fact (stacked, CI, recent changes). Hover them for the full meaning"
            />
         </Group>

         <Group title="Badges">
            <Item
               term={<span className="badge badge-blocked badge-inline">Dev blocked</span>}
               def="a reviewer requested changes: the author’s move"
            />
            <Item
               term={<span className="badge badge-hold badge-inline">Deploy block</span>}
               def="done, deliberately kept from shipping: ask who blocked it"
            />
            <Item
               term={<span className="badge badge-hold badge-inline">Can’t merge</span>}
               def="signed off but conflicted or on an unmerged parent: author rebases"
            />
         </Group>

         <Group title="Catching up">
            <Item
               term={
                  <>
                     <FreshTag kind="new" />
                     <FreshTag kind="updated" />
                  </>
               }
               def="changed since your last visit: “new” is a brand-new PR, “updated” an existing one that changed. Opening one clears it until it changes again"
            />
            <Item
               term={
                  <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 fill-ink-3">
                     <path d="M8 3.5C4.4 3.5 1.7 5.8.6 8c1.1 2.2 3.8 4.5 7.4 4.5s6.3-2.3 7.4-4.5C14.3 5.8 11.6 3.5 8 3.5Zm0 7.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-1.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z" />
                     <path
                        d="M2.4 2.1l11.5 11.5"
                        stroke="var(--ink-3)"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        fill="none"
                     />
                  </svg>
               }
               def="the eye selector reveals off-by-default PRs: Cryogenic Storage and quiet repos"
            />
         </Group>

         <Group title="Query">
            <Item
               term={<code className="font-mono text-[11px] text-ink-2">weight:xs,s</code>}
               def="review-effort class(es), comma list ORs — click a row’s weight meter to toggle it"
            />
            <Item
               term={<code className="font-mono text-[11px] text-ink-2">has:action</code>}
               def="cards where you personally have a move to make"
            />
            <Item
               term={<code className="font-mono text-[11px] text-ink-2">is:restamp</code>}
               def="cards where a push owes you a re-CR or re-QA"
            />
            <Item
               term={<code className="font-mono text-[11px] text-ink-2">is:blocked</code>}
               def="cards under a dev or deploy block"
            />
            <Item
               term="Weight / State"
               def="the point-and-click version of weight:/has:/is: — pick from a dropdown instead of typing. State's Blocked is viewer-relative (a dev block you authored counts as your move), unlike is:blocked, which matches for anyone"
            />
            <Item term="Saved" def="save filter combos from the search box; reapply from Saved" />
         </Group>

         <Group title="Keys">
            <Item term={<Kbd>/</Kbd>} def="focus the filter" />
            <Item
               term={
                  <>
                     <Kbd>j</Kbd>
                     <Kbd>k</Kbd>
                  </>
               }
               def="walk down / up the rows"
            />
            <Item term={<Kbd>↵</Kbd>} def="open the selected PR" />
            <Item term={<Kbd>c</Kbd>} def="copy the selected branch name" />
         </Group>
      </Popover>
   );
}
