import type { CSSProperties, ReactNode } from 'react';
import { Check, CircleDot, X } from 'lucide-react';
import { type DerivedPull, headStatuses } from '../../../shared/model/status';
import type { CommitStatus, Signature } from '../../../shared/types';
import { ago, epoch, n, signatureUrl } from '../../../shared/format';
import { railTriggerClass } from './bits';
import { Avatar } from './identity';
import { Icon } from './Icon';
import { Popover } from './Popover';

const CI_STATE_META: Record<
   CommitStatus['data']['state'],
   { icon: typeof Check; color: string; word: string }
> = {
   success: { icon: Check, color: 'var(--ok)', word: 'passed' },
   failure: { icon: X, color: 'var(--bad)', word: 'failed' },
   error: { icon: X, color: 'var(--bad)', word: 'errored' },
   pending: { icon: CircleDot, color: 'var(--slate)', word: 'running' },
};

const isRedCheck = (s: CommitStatus) => s.data.state === 'failure' || s.data.state === 'error';

// failures first, then the still-running ones, then the greens; alphabetical
// within a tier so the list is stable run to run
function ciRank(s: CommitStatus): number {
   return isRedCheck(s) ? 0 : s.data.state === 'pending' ? 1 : 2;
}

/** completed − started, when both timestamps are known, as a terse "45s"/"6m". */
function ciDuration(s: CommitStatus): string | null {
   const { started_at, completed_at } = s.data;
   if (started_at == null || completed_at == null) return null;
   const secs = Math.max(0, completed_at - started_at);
   return secs < 60 ? `${Math.round(secs)}s` : `${Math.round(secs / 60)}m`;
}

/**
 * CI in the sign-off family: the machine is a reviewer, so it wears the same
 * label + circle-mark anatomy as CR and QA. Only a failure earns ink at rest
 * (a red X disc plus the failing count); a passing or still-running check
 * renders in a reserved, invisible slot and is revealed on row hover — the
 * same "green only on hover" physics the old segmented bar had, now in one
 * vocabulary. The trigger opens the per-check list: state, name, duration,
 * and a link for each. A fixed-width placeholder (not null) stands in for a
 * pull with no checks, so the rail's other slots don't shift row-to-row.
 */
export function CiStatus({ pull }: { pull: DerivedPull }) {
   const checks =
      pull.ci === 'none'
         ? []
         : [...headStatuses(pull.data)].sort(
              (a, b) => ciRank(a) - ciRank(b) || a.data.context.localeCompare(b.data.context)
           );
   if (!checks.length) return <span aria-hidden className="pd-ci-slot inline-block w-[36px]" />;

   const failing = checks.filter(isRedCheck).length;
   const passing = checks.filter(c => c.data.state === 'success').length;
   const pendingCount = checks.filter(c => c.data.state === 'pending').length;
   const pending = pendingCount > 0;
   const summary = failing
      ? `CI: ${failing} of ${checks.length} failing`
      : pending
        ? `CI running · ${passing} of ${checks.length} passed`
        : `CI passed · ${n(checks.length, 'check')}`;
   return (
      <Popover
         label="CI checks"
         side="right"
         hover
         rootClass="relative inline-flex"
         width="w-max min-w-[200px] max-w-[320px]"
         panelClass="p-2 text-xs"
         trigger={t => (
            <button
               {...t}
               type="button"
               aria-label={summary}
               title={summary}
               // -my-2/py-2: a real tap target without changing the rail's height.
               // Quiet states keep their full content at opacity 0 so the reveal
               // can never reflow the line, and CR/QA never shift beside them.
               // One fixed slot width in every state (sized to the failing
               // cluster, the widest), so the rail — and the age numeral's
               // right edge in the meta line — stays one column down a lane.
               className={`pd-ci-slot pressable inline-flex w-[36px] items-center gap-1 px-0 ${railTriggerClass} ${
                  failing > 0 || pending
                     ? ''
                     : 'pd-ci-quiet opacity-0 transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100 [.pd-row:hover_&]:opacity-100 motion-reduce:transition-none'
               }`}
            >
               <span aria-hidden className="w-[18px] text-left text-[11px] font-medium text-ink-3">
                  CI
               </span>
               {/* one circle (styles.css .ci-ring/.ci-fail): a red ring with
                   an X = failing (the fraction lives in the popover; a 1-of-25
                   failure must read as loudly as 25-of-25), the slate ring
                   sweeping closed = running (the sweep is the completed share,
                   v1's grey section reborn), and a closed green ring revealed
                   on row hover = passed (no draw-on-reveal: animation means a
                   state CHANGED, and hovering isn't a change). */}
               {failing > 0 ? (
                  <span aria-hidden className="ci-fail" />
               ) : pending ? (
                  <span
                     aria-hidden
                     className="ci-ring ci-ring-run"
                     style={
                        {
                           '--sweep': `${Math.round(((checks.length - pendingCount) / checks.length) * 360)}deg`,
                        } as CSSProperties
                     }
                  />
               ) : (
                  <span aria-hidden className="ci-ring ci-ring-pass" />
               )}
            </button>
         )}
      >
         <span className="block px-1 pb-1 font-semibold text-ink">
            CI checks
            <span className="ml-1 font-normal text-ink-3 tabular-nums">
               · {passing} of {checks.length} passed
            </span>
         </span>
         {checks.map(c => {
            const meta = CI_STATE_META[c.data.state];
            const dur = ciDuration(c);
            const inner = (
               <>
                  <span className="w-3 flex-none text-center" style={{ color: meta.color }}>
                     <Icon icon={meta.icon} size={12} />
                  </span>
                  <b className="min-w-0 font-medium break-all text-ink">{c.data.context}</b>
                  <span className="flex-none text-ink-3">{meta.word}</span>
                  {dur && (
                     <span className="ml-auto flex-none pl-2 whitespace-nowrap text-ink-3 tabular-nums">
                        {dur}
                     </span>
                  )}
               </>
            );
            return c.data.target_url ? (
               <a
                  key={c.data.context}
                  href={c.data.target_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`open ${c.data.context} on GitHub`}
                  className="flex items-center gap-1.5 rounded px-1 py-[3px] transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none"
               >
                  {inner}
               </a>
            ) : (
               <span key={c.data.context} className="flex items-center gap-1.5 px-1 py-[3px]">
                  {inner}
               </span>
            );
         })}
      </Popover>
   );
}

/**
 * Sign-off state as a circle-check meter: one mark per required stamp, in a
 * fixed-width slot so CR, QA, CI, and the weight letter land at the same x
 * down a board. One mark, three standings (see styles.css .pip): a solid disc
 * = an approval that stands, the same mark drained to an outline = it stood
 * once but a push lapsed it (the most actionable state on the board), an
 * empty ring = still needed, a muted dash = nothing required. A dotted
 * underline marks a slot you personally stamped. No enclosing chip at all:
 * the marks are confident enough to stand bare beside their label — every
 * box, wash, and hairline this slot has worn turned out to be scaffolding
 * (the earlier colored squares and tinted backgrounds were a private code
 * that sent eyes to the rail instead of the titles).
 *
 * `label` only feeds the aria/title strings ("CR 2 of 2…") — it renders
 * nothing here. The visible "CR"/"QA" glyph is the caller's (Row.tsx), the
 * same fixed-width slot the CI label and weight letter use, so a caller can
 * slot something else (the weight letter) between the label and these marks
 * without it ending up inside this component's own hover/click surface.
 */
function Pips({
   label,
   have,
   req,
   by = [],
   staleBy = [],
   me,
   titled = true,
   aligned = false,
}: {
   label: string;
   have: number;
   req: number;
   /** users with a live stamp */
   by?: string[];
   /** users whose stamp a push invalidated */
   staleBy?: string[];
   me?: string;
   /** false when a hover popover wraps these pips (SigPips): the popover
    * carries the same facts, and a native title would stack the browser
    * tooltip under it — the same double-tooltip AgeStamp solved by switching
    * to aria-label. The bare-pips fallback keeps its title. */
   titled?: boolean;
   /** rail context: pad the pip slot to the board-wide max required count
    * (--cr-slots / --qa-slots, set in app.tsx) so every row's marks line up in
    * a column, collapsing when no pull needs many. Off = content-sized. */
   aligned?: boolean;
}) {
   const none = !req && !have && !staleBy.length;
   const met = !none && have >= req;
   const mine = me != null && by.includes(me);
   const owedByMe = me != null && staleBy.includes(me);
   const on = Math.min(have, req);
   const stale = Math.max(0, Math.min(staleBy.length, req - on));
   const off = Math.max(0, req - on - stale);
   const aria = none
      ? `${label} not required`
      : `${label} ${have} of ${req}` +
        (met ? ', done' : '') +
        (mine ? ', including yours' : '') +
        (staleBy.length
           ? owedByMe
              ? ', your stamp was invalidated by a push'
              : `, ${staleBy.join(', ')}'s stamp was invalidated by a push`
           : '');
   const title = none
      ? `${label} not required`
      : staleBy.length
        ? `${staleBy.join(', ')} stamped an earlier version; a push invalidated it`
        : met
          ? mine
             ? `${label} done, including your stamp`
             : `${label} done`
          : `${label}: ${have} of ${req}`;
   // No chip-level tint at all: a filled wash — however muted — out-competed
   // the section headers and titles the eye should scan first (salience is
   // about form, not volume). The re-stamp-owed signal lives on the stale pip
   // itself instead: a thin amber halo confined to its own 8px square (see
   // .pip-stale). The word-group header and the pip-mine underline already
   // say whose move it is; the hover title spells out who and when.
   const slotClass = aligned ? (label === 'CR' ? 'pd-pip-slot-cr' : 'pd-pip-slot-qa') : '';
   return (
      <span
         className="inline-flex items-center gap-1"
         aria-label={aria}
         title={titled ? title : undefined}
      >
         {none ? (
            <span
               aria-hidden
               className={`flex justify-start text-xs text-ink-3 opacity-60 ${slotClass}`}
            >
               –
            </span>
         ) : (
            // Content-sized, so the pip cluster grows and shrinks with the
            // required count: one required stamp shows one mark, four show
            // four, and the slot reserves no empty air for marks a pull
            // doesn't need. (The rail is right-anchored on the age numeral, so
            // a wider cluster grows leftward without moving the numeral.)
            <span
               aria-hidden
               className={`flex items-center justify-start gap-[3px] ${slotClass} ${
                  mine || owedByMe ? 'pip-mine' : ''
               }`}
            >
               {/* keyed by fixed slot, not by fill kind, so a pip that flips
                   off→on (stamp lands) or on→stale (a push invalidates it) is
                   the same node easing its color, not a fresh mount */}
               {[
                  ...Array.from({ length: on }, () => 'on'),
                  ...Array.from({ length: stale }, () => 'stale'),
                  ...Array.from({ length: off }, () => 'off'),
               ].map((kind, i) => (
                  <span key={i} className={`pip pip-${kind}`} />
               ))}
            </span>
         )}
      </span>
   );
}

/**
 * The ledger slot as a drill-down: click to see who signed, who went stale,
 * and when — the answer v1 kept in per-signer bubbles and v2's counts lost.
 * Falls back to the plain ledger when there's nothing to list.
 */
export function SigPips({
   label,
   have,
   req,
   by = [],
   staleBy = [],
   me,
   sigs,
   lead,
   panelExtra,
}: {
   label: string;
   have: number;
   req: number;
   by?: string[];
   staleBy?: string[];
   me?: string;
   sigs: Signature[];
   /** rendered inside the trigger before the pips — the cluster's text label
    * (and, for CR, the weight letter), so the words are part of the door */
   lead?: ReactNode;
   /** an extra panel section under the signer rows (CR carries the weight
    * drill-down here — one popover for the whole cluster) */
   panelExtra?: ReactNode;
}) {
   const pips = (
      <Pips
         label={label}
         have={have}
         req={req}
         by={by}
         staleBy={staleBy}
         me={me}
         titled={false}
         aligned
      />
   );

   // latest signature per user, live stamps first, then invalidated ones
   const latest = new Map<string, Signature>();
   for (const s of sigs) {
      const prev = latest.get(s.data.user.login);
      if (!prev || s.data.created_at > prev.data.created_at) latest.set(s.data.user.login, s);
   }
   const rows = [...latest.values()].sort(
      (a, b) =>
         Number(b.data.active) - Number(a.data.active) ||
         (a.data.created_at < b.data.created_at ? 1 : -1)
   );

   return (
      <Popover
         label={`${label} signatures`}
         side="right"
         hover
         rootClass="relative inline-flex"
         // bounded: an unbounded w-max panel + a long login could grow past
         // the viewport's left edge (side=right anchors the right edge)
         width="w-max min-w-[190px] max-w-[300px]"
         panelClass="p-2 text-xs"
         trigger={t => (
            <button
               {...t}
               type="button"
               aria-label={`${label} stamps: ${have} of ${req}`}
               // no native title: the popover itself opens on this same hover
               // py+negative-my: a real tap target (the marks are ~10px glyphs)
               // without moving anything in the rail's layout
               className={`pressable inline-flex cursor-pointer items-center gap-1 px-0 text-left ${railTriggerClass}`}
            >
               {lead}
               {pips}
            </button>
         )}
      >
         {/* restate the fraction: the trigger's hover title is mouse-only,
             and a tap-opened panel must carry the "how many still needed" */}
         <span className="block px-1 pb-1 font-semibold text-ink">
            {label} stamps
            {req > 0 && (
               <span className="ml-1 font-normal text-ink-3 tabular-nums">
                  · {have} of {req}
               </span>
            )}
         </span>
         {rows.length === 0 && (
            <span className="block px-1 py-[3px] text-ink-3">
               {req === 0 ? `${label} not required.` : 'No stamps yet.'}
            </span>
         )}
         {rows.map(s => (
            <a
               key={s.data.user.login}
               href={signatureUrl(s)}
               target="_blank"
               rel="noopener noreferrer"
               title="open this stamp’s comment on GitHub"
               className="flex items-center gap-1.5 rounded px-1 py-[3px] text-ink-2 transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none"
            >
               <Avatar login={s.data.user.login} size={16} />
               <b className="min-w-0 font-medium break-all text-ink">{s.data.user.login}</b>
               {s.data.user.login === me && <span className="text-ink-3">(you)</span>}
               <span className="ml-auto pl-3 whitespace-nowrap text-ink-3 tabular-nums">
                  {ago(epoch(s.data.created_at))} ago
               </span>
               {s.data.active ? (
                  <span className="pip pip-on" title="active stamp" />
               ) : (
                  <span className="pip pip-stale" title="invalidated by a later push" />
               )}
            </a>
         ))}
         {/* the mark vocabulary, keyed right where the marks are read — the
             legend stays a conventions card, not a per-mark decoder. Hidden
             when the requirement is waived and there's nothing to decode. */}
         {(rows.length > 0 || req > 0) && (
            <span className="mt-1 flex items-center gap-1 border-t border-secondary px-1 pt-1.5 text-[11px] text-ink-3">
               <span className="pip pip-on" /> stands
               <span className="pip pip-stale ml-1.5" /> stale review
               <span className="pip pip-off ml-1.5" /> needed
            </span>
         )}
         {panelExtra}
      </Popover>
   );
}
