import type { ReactNode } from 'react';
import { CircleHelp, Heart, Star } from 'lucide-react';
import { HeaderIconButton } from './bits';
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
         trigger={t => <HeaderIconButton {...t} icon={CircleHelp} label="how to read the board" />}
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
               def="one circle per required stamp, in order: stands, stale review, still needed. A dotted underline marks yours; click them for who signed. While a PR is a draft, blocked, or red, the re-ask waits: the author moves first"
            />
            <Item
               term={
                  <span className="inline-flex items-center gap-1">
                     <span className="text-[11px] font-medium text-ink-3">CI</span>
                     <span className="ci-fail" />
                     <span
                        className="ci-ring ci-ring-run"
                        style={{ '--sweep': '240deg' } as never}
                     />
                  </span>
               }
               def="CI is one circle, the machine’s mark: the red ring with a center dot, a check failed; the ring sweeping shut is a run in progress, the filled share done. On row hover a green ring closes the loop: passed. No news is good news"
            />
         </Group>

         <Group title="Authors">
            <Item
               term={
                  <span className="inline-flex items-center gap-1">
                     <span
                        aria-hidden
                        className="h-3.5 w-3.5 rounded-full"
                        style={{ background: 'var(--line)' }}
                     />
                     <span
                        aria-hidden
                        className="h-3.5 w-3.5 rounded-[3px]"
                        style={{ background: 'var(--line)' }}
                     />
                  </span>
               }
               def="a circle avatar is a person; a square tile is a bot or app"
            />
            <Item
               term={
                  <span className="inline-flex items-center gap-1 text-brand">
                     <Icon icon={Heart} size={13} fill="currentColor" />
                     <Icon icon={Star} size={13} fill="currentColor" />
                  </span>
               }
               def="a corner heart marks someone on your team; the star seated on your own avatar’s rim is you"
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
               term={<span className="text-xs font-medium text-brand">Claim</span>}
               def="hover a row for its verbs. Claiming adds you as a reviewer on the PR, so GitHub and the board both show you’re on it; the row moves to Waiting on you until you submit, release, or are removed"
            />
            <Item
               term={<span className="text-ink-2 italic">review requested</span>}
               def="someone requested your review on GitHub. Lands in Waiting on you, and the board quiets its own suggestions for that PR"
            />
            <Item
               term={<span className="text-ink-2 italic">your turn</span>}
               def="a review that sat too long, pointed at the best-matched reviewer. A nudge, not a lock: anyone can take it"
            />
         </Group>

         <Group title="Query">
            <Item
               term={<code className="font-mono text-[11px] text-ink-2">weight:xs,s</code>}
               def="review-effort classes; a row shows its class as a letter beside CR, detailed in the CR popover"
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
            <Item
               term={<code className="font-mono text-[11px] text-ink-2">is:draft</code>}
               def="still a draft"
            />
            <Item
               term={<code className="font-mono text-[11px] text-ink-2">is:mine</code>}
               def="opened by you"
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
