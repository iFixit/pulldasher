import type { ReactNode } from 'react';
import { useSettings } from '../settings';
import { DiffSize, WeightMeter } from './bits';
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
               def="one mark per required stamp: a solid check is an approval that stands, an empty ring is still needed. Click a row’s marks for who signed"
            />
            <Item
               term={
                  <span className="inline-flex items-center gap-1">
                     <span className="pip pip-on" />
                     <span className="pip pip-stale" />
                  </span>
               }
               def="the outlined check is an approval a later push left stale: it stood once, and needs re-confirming against the new code"
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
               term={<span className="text-ink-2 italic">is testing it</span>}
               def="someone claimed QA by adding the QAing label on GitHub"
            />
         </Group>

         <Group title="Reading a row">
            <Item
               term={
                  <span className="relative inline-block h-3 w-16">
                     <span
                        className="absolute bottom-0 left-0 h-px w-2/3"
                        style={{ background: 'color-mix(in oklab, var(--ink-3) 75%, transparent)' }}
                     />
                  </span>
               }
               def={`age: a grey hairline along a row's bottom edge appears once it's ${s.ageWarnDays}+ days without full review; its length and depth are relative to the board's longest-open pull, so the oldest runs full width in full grey. The quiet day count at the row's right edge caps it and just gets bolder; hover it for both clocks`}
            />
            <Item
               term={
                  <span className="inline-flex items-center gap-1">
                     <WeightMeter weight="XS" />
                     <WeightMeter weight="M" />
                     <WeightMeter weight="XL" />
                  </span>
               }
               def="review effort: the strip under the CR/QA marks fills with the review’s weight, doubling per class: a sliver = a quick pickup, full = very heavy. Hover for the exact +/− lines, click to filter"
            />
            <details className="group/weight mt-0.5 px-1">
               <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-[11px] font-medium text-ink-3 hover:text-ink-2">
                  <span aria-hidden className="transition-transform group-open/weight:rotate-90">
                     ▸
                  </span>
                  How weight is decided
               </summary>
               <div className="space-y-1.5 pt-0.5 pb-1 pl-3 text-ink-2">
                  <p>
                     XS through XL is roughly how much review a PR will take, lightest to heaviest.
                     The board sorts by it, and you can filter on it (
                     <code className="font-mono text-[11px]">weight:xs,s</code>).
                  </p>
                  <p>
                     If the PR carries one of the org’s size labels, that wins: it’s deterministic,
                     per-file-weighted, and versioned with the labeller. With no label it’s a guess
                     from the diff: under 50 lines changed reads XS, under 150 S, under 600 M, under
                     1500 L, and 1500+ XL, bumped up a class when the PR spans more than 15 files.
                  </p>
                  <p>
                     It’s only a prior, never a verdict: a tiny diff can hide a subtle change and a
                     big one can be a rename sweep, so the meter points you at what to read, it
                     doesn’t decide for you.
                  </p>
               </div>
            </details>
            <Item
               term={
                  <span className="inline-flex items-center gap-1">
                     <span className="text-[11px] font-medium text-ink-3">CI</span>
                     <span className="pip pip-fail pip-alarm" />
                     <span className="pip pip-run" />
                  </span>
               }
               def="CI wears the same marks as CR and QA. The machine is a reviewer too. A red ✗ disc, drawn a size larger than every other mark, means failing checks (the count beside it says how many); the gray-blue ring means still running. Passing shows nothing at rest. No news is good news; hover a row for its quiet green check and the per-check list"
            />
            <Item
               term={<DiffSize additions={120} deletions={30} />}
               def="lines added and removed, neutral on purpose: a line count is a routine fact, not a verdict"
            />
            <Item
               term={
                  <>
                     <span className="flag-warn">conflicts</span>
                     <span className="flag-note">stacked</span>
                  </>
               }
               def="row flags: amber = act on it (conflicts, deploy block, external), gray = a neutral fact (stacked, CI, recent changes). Hover them for the full meaning"
            />
            <Item
               term={
                  <span className="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-[11px] leading-none font-medium text-brand-700">
                     <span aria-hidden>◆</span>region
                  </span>
               }
               def="matches a code region you set in Settings; these gather in the “In your code regions” section on Review and Team"
            />
            <details className="group/region mt-0.5 px-1">
               <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-[11px] font-medium text-ink-3 hover:text-ink-2">
                  <span aria-hidden className="transition-transform group-open/region:rotate-90">
                     ▸
                  </span>
                  How regions work
               </summary>
               <div className="space-y-1.5 pt-0.5 pb-1 pl-3 text-ink-2">
                  <p>
                     Code regions are free text you set in Settings, the areas you own or follow,
                     like “Growthbook” or “Shopify”. They’re a plain text match, not a regex.
                  </p>
                  <p>
                     A PR matches when a region appears, case-insensitively, anywhere in the text
                     already on the board: its title, description, repo, branch name, or labels.
                     Changed file paths aren’t checked (the board never fetches them). A match earns
                     the ◆ chip, floats up your queue, and collects in “In your code regions”.
                  </p>
               </div>
            </details>
            <Item
               term={<span aria-hidden>✦</span>}
               def="review requested: GitHub asked you directly. These PRs land in Waiting on you, and the board quiets its own turn rotation for them"
            />
         </Group>

         <Group title="Coordination">
            <Item
               term={
                  <span aria-hidden className="text-brand">
                     ✋
                  </span>
               }
               def="claim a review so teammates know you’re on it; the hand stays lit on your row, and claimed PRs collect in “You’re reviewing”. It nudges you when it goes stale and clears itself when it expires, both set in Settings (defaults: 2h and 4h)"
            />
            <Item
               term={<span className="text-ink-2 italic">X is reading it</span>}
               def="someone else has claimed this review"
            />
            <details className="group/claim mt-0.5 px-1">
               <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-[11px] font-medium text-ink-3 hover:text-ink-2">
                  <span aria-hidden className="transition-transform group-open/claim:rotate-90">
                     ▸
                  </span>
                  How claims work
               </summary>
               <div className="space-y-1.5 pt-0.5 pb-1 pl-3 text-ink-2">
                  <p>
                     Claims live in the server’s memory, never the database. Claiming sends a
                     message over the live websocket; the server records it and broadcasts the
                     updated list to everyone on the board, so others see “X is reading it” at once.
                  </p>
                  <p>
                     Because it’s only in memory, a server restart clears every claim, and nothing
                     you claim is ever written to disk.
                  </p>
                  <p>
                     Claims expire on their own: a claim goes stale when your warning time passes
                     (it stops holding others off, and you’re nudged to finish or release it), and
                     is dropped entirely when its length runs out. Both are set in Settings,
                     defaulting to 2h and 4h. Releasing clears it for everyone right away.
                  </p>
               </div>
            </details>
            <Item
               term={<span className="text-ink-2 italic">your turn</span>}
               def="a starved review nobody’s on gets pointed at the best-matched person so it doesn’t sit forever; a toast asks them to claim it, and anyone can still take it"
            />
            <details className="group/turn mt-0.5 px-1">
               <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-[11px] font-medium text-ink-3 hover:text-ink-2">
                  <span aria-hidden className="transition-transform group-open/turn:rotate-90">
                     ▸
                  </span>
                  How your turn is picked
               </summary>
               <div className="space-y-1.5 pt-0.5 pb-1 pl-3 text-ink-2">
                  <p>
                     When a PR has gone too long without enough CR and nobody has claimed it, the
                     board points it at one reviewer so it stops falling through the cracks. The
                     candidates are everyone who’s CR’d that repo before (minus the author and
                     anyone who already stamped this one), so they all know the code; the pick then
                     favors whoever the author has reviewed before, a good turn owed back, the same
                     signal “Deal me one” leans on.
                  </p>
                  <p>
                     If you’re the pick, a toast asks you to claim it right there (which also adds
                     you as a GitHub reviewer). Every client lands on the same name with no
                     coordination, and ties spread across PRs so it isn’t always one person. It’s a
                     nudge, not a lock; anyone can take it, and an explicit GitHub review request
                     overrides the guess entirely.
                  </p>
               </div>
            </details>
         </Group>

         <Group title="Groups">
            <Item
               term={
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">
                     Re-stamp · 3
                  </span>
               }
               def="brand group header: cards under it need an action from you; the word is the action. Hover any header for its one-line meaning"
            />
            <Item
               term={
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                     waiting on CR · 2
                  </span>
               }
               def="gray group header: why those cards wait. Hover a card’s repo #number for the full state: status, names, dates, CI, feedback"
            />
         </Group>

         <Group title="Catching up">
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
               def="review-effort class(es), comma list ORs; click a row’s weight meter to toggle it"
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
               def="the point-and-click version of weight:/has:/is:, pick from a dropdown instead of typing. State's Blocked is viewer-relative (a dev block you authored counts as waiting on you), unlike is:blocked, which matches for anyone"
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
