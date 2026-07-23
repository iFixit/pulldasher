import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Star } from 'lucide-react';
import { githubAvatarUrl, githubProfileUrl, loginHue } from '../format';
import { displayName, requestNames, useNames } from '../model/names';
import { Icon } from './Icon';
import { Popover } from './Popover';

/**
 * The board's author-identity system — the silhouette and the star:
 *
 * - SHAPE answers "person or machine": people are circles, bots (GitHub
 *   Apps and config-listed machine accounts) are rounded squares, the
 *   app-tile idiom Slack and GitHub already taught. No glyph, no hue — the
 *   outline is the mark, so it reads at 16px and in peripheral vision.
 * - The BOTTOM-RIGHT CORNER answers "what is this person to you", in one
 *   glyph: a small star on a teammate (your review circle), and a larger star seated on
 *   the rim of your own avatar with a bite masked out of the face, so your
 *   silhouette is visibly broken. You are the star vocabulary's largest
 *   case — escalated by size and form, never by fill. (The ringed seal and
 *   the v1 star-coin both died here: a halo reads as focus, a coin loses
 *   the face.)
 * - Identity, never state: none of it animates or changes with PR status.
 */

/** The you-mark's geometry, shared by the face's bite mask and the star
 * seated in it: star size, the star's center relative to the avatar box,
 * and the moat (bite) radius. One source so mask and glyph can't drift. */
function youStarGeometry(size: number) {
   const star = size >= 20 ? 13 : 11;
   const offset = size >= 20 ? 3 : 2.5;
   const center = size + offset - star / 2;
   return { star, offset, center, moat: star / 2 + 2 };
}

/**
 * The face itself: the GitHub picture over the deterministic-hue initials.
 * The initials sit underneath and show through the instant the image 404s
 * (bots, deleted accounts, an offline CDN) — so we always render something,
 * never a broken-image glyph.
 */
function AvatarFace({
   login,
   size,
   shape = 'circle',
   bitten = false,
}: {
   login: string;
   size: number;
   /** 'square' = a bot/app tile (~18% corner radius); 'circle' = a person */
   shape?: 'circle' | 'square';
   /** notch the bottom-right rim out of the face so the you-star can seat
    * IN the silhouette rather than merely on top of it */
   bitten?: boolean;
}) {
   const [broken, setBroken] = useState(false);
   // OKLCH holds perceived lightness constant across the hue wheel — the old
   // hsl(h 45% 45%) made yellow-green logins illegible under white text
   const style: CSSProperties = {
      background: `oklch(0.48 0.09 ${loginHue(login)})`,
      width: size,
      height: size,
      fontSize: Math.round(size * 0.42),
      borderRadius: shape === 'square' ? Math.max(3, Math.round(size * 0.18)) : 9999,
   };
   if (bitten) {
      const g = youStarGeometry(size);
      // transparent moat, not a painted stroke: the bite stays correct over
      // any row background (hover, fresh-flash), which the old seal's
      // surface-colored outline never quite did
      const mask = `radial-gradient(circle at ${g.center}px ${g.center}px, transparent ${g.moat - 0.25}px, #000 ${g.moat + 0.25}px)`;
      style.WebkitMaskImage = mask;
      style.maskImage = mask;
   }
   return (
      <span
         className="relative inline-flex flex-none items-center justify-center overflow-hidden font-semibold uppercase text-white"
         style={style}
      >
         {login.slice(0, 2)}
         {!broken && (
            <img
               src={githubAvatarUrl(login, size)}
               alt=""
               aria-hidden
               loading="lazy"
               className="absolute inset-0 h-full w-full object-cover"
               onError={() => setBroken(true)}
            />
         )}
      </span>
   );
}

/** The hover card behind a clickable avatar: the picture bigger, the human
 * name when GitHub has one (resolved through model/names.ts's cached
 * server-side lookup), the handle, and a jump to their GitHub profile. */
function PersonCard({ login }: { login: string }) {
   const names = useNames();
   useEffect(() => requestNames([login]), [login]);
   const name = displayName(names, login);
   return (
      <div className="flex items-center gap-2.5 text-[13px]">
         <AvatarFace login={login} size={40} />
         <div className="min-w-0">
            <a
               href={githubProfileUrl(login)}
               target="_blank"
               rel="noopener noreferrer"
               className="block truncate font-semibold text-ink hover:underline"
               title={`@${login} on GitHub`}
            >
               {name ?? login}
            </a>
            <a
               href={githubProfileUrl(login)}
               target="_blank"
               rel="noopener noreferrer"
               className="text-[11px] text-ink-3 hover:text-brand hover:underline"
            >
               {name ? `@${login} · ` : ''}GitHub profile ↗
            </a>
         </div>
      </div>
   );
}

export function Avatar({
   login,
   size = 22,
   onClick,
   shape = 'circle',
   you = false,
}: {
   login: string;
   size?: number;
   onClick?: (login: string) => void;
   /** 'square' for bot/app authors — see the identity-system note above */
   shape?: 'circle' | 'square';
   /** the viewer's own avatar: wears the seated corner star + bitten rim */
   you?: boolean;
}) {
   const g = you ? youStarGeometry(size) : null;
   // the star rides INSIDE whatever scales on hover, so the bite in the face
   // and the star seated in it can never fall out of registration
   const face = (
      <span className="relative inline-flex flex-none">
         <AvatarFace login={login} size={size} shape={shape} bitten={you} />
         {g && (
            <span
               role="img"
               aria-label="yours"
               className="pointer-events-none absolute inline-flex text-brand"
               style={{ right: -g.offset, bottom: -g.offset }}
            >
               <Icon icon={Star} size={g.star} fill="currentColor" />
            </span>
         )}
      </span>
   );
   if (!onClick) {
      return (
         <span title={login} className="inline-flex">
            {face}
         </span>
      );
   }
   // A clickable avatar keeps its one-click "filter to this person" gesture
   // (the trigger's own onClick), and grows a hover preview card on top — the
   // same hover-open/pin discipline AgeStamp and the ledger use. Hover is a
   // supplement (the picture bigger + a GitHub link); the click action stays
   // fully keyboard- and touch-reachable.
   return (
      <Popover
         label={login}
         hover
         side="left"
         rootClass="relative inline-flex"
         width="w-[220px]"
         panelClass="p-2.5"
         trigger={t => (
            <button
               {...t}
               type="button"
               // .hit: the circle is 16-22px, under the 24px target floor
               className="hit pressable cursor-pointer border-0 p-0 transition-[scale] duration-150 ease-out hover:scale-115 motion-reduce:transition-none"
               aria-label={you ? `${login} (you): view your PRs` : `${login}: view their PRs`}
               // click filters to this person; the hover card is the extra
               onClick={() => onClick(login)}
            >
               {face}
            </button>
         )}
      >
         <PersonCard login={login} />
      </Popover>
   );
}

/**
 * The one star mark every "primary repo" / "teammate" toggle shares
 * (Row's kebab menu, RepoFilter, PeopleFilter, RepoManager): filled when on,
 * outline when off, same lucide glyph everywhere instead of five hand-rolled
 * ★/☆ copies.
 */
export function StarMark({ on, size = 14 }: { on: boolean; size?: number }) {
   return <Icon icon={Star} size={size} fill={on ? 'currentColor' : 'none'} />;
}
