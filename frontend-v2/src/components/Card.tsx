import type { ReactNode } from 'react';
import { Avatar, PullTitleLink } from './bits';

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

/** The elbow before a nested row's avatar — one CSS hairline that says
 * "child of the row above". Absolutely positioned inside the indent gutter
 * so it costs the row zero flex width (a glyph in the flow both rendered as
 * a literal "L" and squeezed the rail into overflow in narrow columns). */
function StackConnector({ compact, depth }: { compact: boolean; depth: number }) {
   const basePad = compact ? 12 : 14;
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

export function CardShell({
   login,
   onPerson,
   repo,
   number,
   title,
   onOpen,
   className = '',
   meta,
   rail,
   stretch = true,
   compact = false,
   avatarBadge,
   depth = 0,
}: {
   login: string;
   onPerson?: (login: string) => void;
   repo: string;
   number: number;
   title: string;
   onOpen?: () => void;
   className?: string;
   /** the meta line: badge, repo#number, context, flags */
   meta: ReactNode;
   /** the fixed metric rail (weight, pips, age). A separate slot on purpose:
    * in compact it renders outside the wrapping content column, so the
    * metrics hold a stable right rail while the text flows. Comfortable
    * keeps it on the wrapping meta line. */
   rail?: ReactNode;
   stretch?: boolean;
   compact?: boolean;
   /** a tiny marker absolutely-positioned over the avatar (the row's starred-
    * author ★) — a slot rather than an Avatar prop, so this stays a one-
    * caller concern instead of touching every Avatar call site. */
   avatarBadge?: ReactNode;
   /** stack-nesting depth (0 = top-level): indents the row and shows a
    * connector elbow before the avatar — model/stack.ts's groupIntoTree
    * supplies it. Capped at 2 by the model; the geometry doesn't need its
    * own cap on top of that. */
   depth?: number;
}) {
   const titleLink = (
      <PullTitleLink repo={repo} number={number} title={title} onOpen={onOpen} stretch={stretch} />
   );
   const connector = depth > 0 && <StackConnector compact={compact} depth={depth} />;

   if (compact) {
      return (
         <div
            className={`pd-row relative flex items-center gap-2 border-t border-secondary py-1 pr-3 first:border-t-0 hover:bg-muted ${className}`}
            style={{ paddingLeft: 12 + depth * STACK_INDENT_PX }}
         >
            {connector}
            {/* raise only when the avatar is a real button — a raised inert
                span punches a dead zone into the whole-row click target */}
            <span className={`relative flex-none ${onPerson ? 'pd-raise' : ''}`}>
               <Avatar login={login} onClick={onPerson} size={16} />
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
         </div>
      );
   }

   return (
      <div
         className={`pd-row relative flex items-start gap-2.5 border-t border-secondary py-2 pr-3.5 first:border-t-0 hover:bg-muted ${className}`}
         style={{ paddingLeft: 14 + depth * STACK_INDENT_PX }}
      >
         {connector}
         <span className={`relative mt-px flex-none ${onPerson ? 'pd-raise' : ''}`}>
            <Avatar login={login} onClick={onPerson} />
            {avatarBadge}
         </span>
         <span className="min-w-0 flex-1">
            <span className="block text-sm leading-snug break-words">{titleLink}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
               {meta}
               {rail}
            </span>
         </span>
      </div>
   );
}
