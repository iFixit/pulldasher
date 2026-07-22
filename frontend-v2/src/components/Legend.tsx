import type { ReactNode } from 'react';
import { CircleHelp, Hand } from 'lucide-react';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { eyebrowText } from './WordGroups';

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
         <div className={`px-1 pb-0.5 text-ink-3 ${eyebrowText}`}>{title}</div>
         {children}
      </div>
   );
}

/**
 * The conventions card, not an encyclopedia. Everything tied to one mark
 * explains itself where the mark is — the sign-off ledger keys its own pips,
 * the CI / weight / age popovers carry their own rules, every group header
 * glosses its word on hover, the hidden count names what it hides. What
 * remains here is only what no single mark can teach: the board's invented
 * vocabulary (stamp), its color grammar, the coordination signals, the query
 * tokens, and the keyboard. One screen, no folds, no scrolling essays.
 */
export function Legend() {
   return (
      <Popover
         label="Board conventions"
         side="right"
         width="w-[420px] max-w-[calc(100vw-2rem)]"
         panelClass="max-h-[85vh] overflow-auto p-3 text-xs"
         trigger={t => (
            <button
               {...t}
               type="button"
               aria-label="how to read the board"
               title="how to read the board"
               className="pressable inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-3 hover:text-brand"
            >
               <Icon icon={CircleHelp} size={16} />
            </button>
         )}
      >
         <span className="block px-1 pb-0.5 text-[13px] font-semibold text-ink">
            Reading the board
         </span>
         <p className="px-1 pb-1.5 leading-snug text-ink-3">
            Everything explains itself where it sits: hover any mark, flag, header, or count. These
            are the conventions that don’t announce themselves.
         </p>

         <Group title="Stamps">
            <Item
               term={<b className="font-semibold text-ink">stamp</b>}
               def="a CR or QA sign-off: a GitHub approval, or a “CR 👍” / “QA 👍” comment. A push undoes it until it’s re-confirmed"
            />
            <Item
               term={
                  <span className="inline-flex items-center gap-1">
                     <span className="pip pip-on" />
                     <span className="pip pip-stale" />
                     <span className="pip pip-off" />
                  </span>
               }
               def="one circle per required stamp, in order: stands, staled by a push, still needed. A dotted underline marks yours; click them for who signed. While a PR is a draft, blocked, or red, the re-ask waits: the author moves first"
            />
            <Item
               term={
                  <span className="inline-flex items-center gap-1">
                     <span className="text-[11px] font-medium text-ink-3">CI</span>
                     <span className="ci-disc" />
                     <span
                        className="ci-ring ci-ring-run"
                        style={{ '--sweep': '240deg' } as never}
                     />
                  </span>
               }
               def="CI is one circle, the machine’s mark: solid red, a check failed; the ring sweeping shut is a run in progress, the filled share done. On row hover a green ring closes the loop: passed. No news is good news"
            />
         </Group>

         <Group title="Color">
            <Item
               term={
                  <span className="text-[11px] font-semibold tracking-wide text-brand-700 uppercase">
                     Re-stamp · 3
                  </span>
               }
               def="brand is your move: a brand header names an action you owe, a gray one says why a card waits. Hover the word for its meaning"
            />
            <Item
               term={
                  <>
                     <span className="flag-warn">conflicts</span>
                     <span className="flag-note">stacked</span>
                  </>
               }
               def="amber flag: act on it. Gray flag: a plain fact"
            />
         </Group>

         <Group title="Coordination">
            <Item
               term={
                  <span className="text-ink-3">
                     <Icon icon={Hand} size={14} />
                  </span>
               }
               def="claim a review: adds you as a reviewer on the PR, so GitHub and the board both show you’re on it. Clears when you submit, release, or are removed"
            />
            <Item
               term={<span className="text-ink-2 italic">requested from you</span>}
               def="GitHub asked you directly. Lands in Waiting on you, and the board quiets its own suggestions for that PR"
            />
            <Item
               term={<span className="text-ink-2 italic">your turn</span>}
               def="a review that sat too long, pointed at the best-matched reviewer. A nudge, not a lock: anyone can take it"
            />
         </Group>

         <Group title="Query">
            <Item
               term={<code className="font-mono text-[11px] text-ink-2">weight:xs,s</code>}
               def="review-effort classes; a row’s weight letter filters with a click"
            />
            <Item
               term={<code className="font-mono text-[11px] text-ink-2">has:action</code>}
               def="cards where the next move is yours"
            />
            <Item
               term={<code className="font-mono text-[11px] text-ink-2">is:restamp</code>}
               def="a push undid your stamp and the PR is reviewable again"
            />
            <Item
               term={<code className="font-mono text-[11px] text-ink-2">is:blocked</code>}
               def="under a dev or deploy block, whoever holds it"
            />
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
