import type { ReactNode } from 'react';
import { PullTitleLink } from './bits';
import { Avatar } from './identity';

/**
 * The one row every lens renders. Two densities of the same content:
 *
 * - comfortable: avatar + full-width wrapping title on top, one meta line
 *   below. Giving the title its own line lets a long title wrap cleanly
 *   instead of fighting a dozen metadata chips, and lets the card reflow to a
 *   phone.
 * - compact: everything on one flowing line — avatar, title, meta chips, the
 *   right-anchored rail — with a smaller avatar and tighter padding. When the
 *   column is narrower than the content, the line wraps; nothing ever
 *   ellipsizes. Density comes from the tighter geometry, never from hiding
 *   text.
 *
 * The meta content is the caller's; only the shell (and its geometry) is
 * shared, so the rail lands at the same x down the board in every lens. The
 * title link stretches over the whole card (`stretch`), so a click anywhere
 * opens the PR; genuinely interactive children opt back out with `.pd-raise`.
 */
/** Per-depth left inset for a stacked (nested) row: enough to read as a
 * child without starving narrow columns (Classic's are the tight case). */
const STACK_INDENT_PX = 16;

/** The comfortable/compact left-pad a stack connector starts from — shared
 * by StackConnector and StackStub so the two elbow shapes always align on
 * the same origin regardless of density. */
const stackBasePad = (compact: boolean) => (compact ? 12 : 14);

/** The elbow before a nested row's avatar — one CSS hairline that says
 * "child of the row above". Absolutely positioned inside the indent gutter
 * so it costs the row zero flex width (a glyph in the flow both rendered as
 * a literal "L" and squeezed the rail into overflow in narrow columns). */
function StackConnector({ compact, depth }: { compact: boolean; depth: number }) {
   const basePad = stackBasePad(compact);
   return (
      <span
         aria-hidden
         className="absolute w-[9px] rounded-bl-[5px] border-b border-l border-line"
         style={{
            left: basePad + (depth - 1) * STACK_INDENT_PX + 2,
            top: 0,
            // the horizontal arm lands on the avatar's vertical center
            height: compact ? 13 : 19,
         }}
      />
   );
}

/**
 * The connector's other standing: a stacked row whose parent ISN'T the row
 * above (it lives in another lane, a fold, or another lens' scope) can't
 * nest, so it wears the same elbow truncated to a stub — a few quiet pixels
 * of the same line, rising to the row's top edge where the parent would
 * have been. One vocabulary, two states: the full elbow means "child of
 * the row above", the stub means "child of something that isn't here". The
 * row's "stacked on #N" flag stays the door that names and links the
 * parent; this is pure geometry, so the split-stack case reads at a glance
 * instead of only in words.
 */
function StackStub({ compact }: { compact: boolean }) {
   const basePad = stackBasePad(compact);
   return (
      <span
         aria-hidden
         className="absolute w-[9px] rounded-bl-[5px] border-b border-l border-line"
         style={{
            left: basePad + 2,
            top: 0,
            // the same elbow shape, cut short: it points up and out of the
            // row instead of reaching a parent's vertical center
            height: compact ? 6 : 8,
         }}
      />
   );
}

export function CardShell({
   login,
   onPerson,
   repo,
   number,
   title,
   body,
   id,
   className = '',
   meta,
   rail,
   stretch = true,
   compact = false,
   own = false,
   bot = false,
   avatarBadge,
   edge,
   depth = 0,
   stackStub = false,
}: {
   login: string;
   onPerson?: (login: string) => void;
   repo: string;
   number: number;
   title: string;
   /** PR description for the title's hover preview */
   body?: string;
   /** stable DOM id (format.ts's rowDomId) — lets toasts scroll to and
    * flash the row it just claimed. */
   id?: string;
   className?: string;
   /** the meta line: badge, repo#number, context, flags */
   meta: ReactNode;
   /** the fixed metric rail (CI, sign-off marks, weight). A separate slot on
    * purpose: comfortable renders it as its own right-hand column, vertically
    * centered in the row; compact keeps it in the flowing line. In narrow
    * columns the container query wraps it to a full-width line below. */
   rail?: ReactNode;
   stretch?: boolean;
   compact?: boolean;
   /** the viewer authored this pull: the avatar wears the you-mark (the
    * corner star seated in a bite on its rim — see identity.tsx's identity
    * system note) */
   own?: boolean;
   /** a bot/app author: the avatar renders as a rounded-square tile instead
    * of a circle — shape is the whole mark */
   bot?: boolean;
   /** a tiny marker absolutely-positioned over the avatar (the row's teammate
    * author ★) — a slot rather than an Avatar prop, so this stays a one-
    * caller concern instead of touching every Avatar call site. */
   avatarBadge?: ReactNode;
   /** a row-edge overlay (the age baseline): absolutely positioned against
    * the pd-row (already relative), rendered last so it paints over the
    * divider without entering the flex flow. Hoverable/focusable now (its
    * own popover door), not pure decoration. */
   edge?: ReactNode;
   /** stack-nesting depth (0 = top-level): indents the row and shows a
    * connector elbow before the avatar — model/stack.ts's groupIntoTree
    * supplies it. Capped at 2 by the model; the geometry doesn't need its
    * own cap on top of that. */
   depth?: number;
   /** a stacked pull rendering flat (its parent isn't the row above): wears
    * the connector's stub form — see StackStub. Ignored when depth > 0. */
   stackStub?: boolean;
}) {
   const titleLink = (
      <PullTitleLink repo={repo} number={number} title={title} body={body} stretch={stretch} />
   );
   const connector =
      depth > 0 ? (
         <StackConnector compact={compact} depth={depth} />
      ) : stackStub ? (
         <StackStub compact={compact} />
      ) : null;

   if (compact) {
      return (
         <div
            id={id}
            className={`pd-row relative flex items-center gap-2 border-t border-secondary py-1 pr-3 first:border-t-0 hover:bg-muted ${className}`}
            style={{ paddingLeft: 12 + depth * STACK_INDENT_PX }}
         >
            {connector}
            {/* raise only when the avatar is a real button — a raised inert
                span punches a dead zone into the whole-row click target */}
            <span className={`relative flex-none ${onPerson ? 'pd-raise' : ''}`}>
               <Avatar
                  login={login}
                  onClick={onPerson}
                  size={16}
                  shape={bot ? 'square' : 'circle'}
                  you={own}
               />
               {avatarBadge}
            </span>
            {/* nothing here truncates: the row flows as one tight line and
                wraps when the column is narrower than the content — density
                comes from geometry, never from hiding text. The rail rides
                the same flow (its ml-auto keeps it right-aligned), so in a
                narrow column it drops below the text instead of starving it */}
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
               <span className="min-w-0 text-[13px] leading-snug break-words">{titleLink}</span>
               {meta}
               {rail}
            </span>
            {edge}
         </div>
      );
   }

   return (
      <div
         id={id}
         // flex-wrap exists solely for the rail: in a narrow column the
         // container query gives .pd-rail flex-basis:100%, wrapping it to its
         // own full-width line under the text
         className={`pd-row relative flex flex-wrap items-start gap-2.5 border-t border-secondary py-2 pr-3.5 first:border-t-0 hover:bg-muted ${className}`}
         style={{ paddingLeft: 14 + depth * STACK_INDENT_PX }}
      >
         {connector}
         <span className={`relative mt-px flex-none ${onPerson ? 'pd-raise' : ''}`}>
            <Avatar login={login} onClick={onPerson} shape={bot ? 'square' : 'circle'} you={own} />
            {avatarBadge}
         </span>
         <span className="min-w-0 flex-1">
            <span className="block text-sm leading-snug break-words">{titleLink}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
               {meta}
            </span>
         </span>
         {/* the rail rides as its own right-hand column, vertically centered
             in the row (styles.css .pd-row > .pd-rail) — the two-line card's
             height becomes deliberate space around the marks instead of dead
             air above trailing chips */}
         {rail}
         {edge}
      </div>
   );
}
