import { useEffect, useState, type CSSProperties } from 'react';

/**
 * The "pulldasher" wording next to the mark, one span per letter so the
 * word can be DEALT: letters slide out from behind the deer left-to-right
 * on show and tuck back toward it on hide (styles.css .wm-*) — the same
 * gesture as the board dealing you a review. Shown only when the header
 * gutter can afford it (the 2xl breakpoint the neighboring header text
 * uses), but mounted always: the h1 is absolutely positioned, so neither
 * state touches layout.
 *
 * Mounts straight into its final state on purpose: page load gets NO
 * animation (a board you open ten times a day shouldn't perform an
 * entrance) — the letters only deal when a resize carries the wordmark
 * across the breakpoint, in or out of view.
 *
 * aria-hidden: the Logo beside it already carries the accessible name
 * "Pulldasher"; per-letter spans would only spell noise at a screen reader.
 */
export function Wordmark() {
   const [shown, setShown] = useState(() => matchMedia('(min-width: 1536px)').matches);
   useEffect(() => {
      const mq = matchMedia('(min-width: 1536px)');
      const follow = () => setShown(mq.matches);
      mq.addEventListener('change', follow);
      return () => mq.removeEventListener('change', follow);
   }, []);
   return (
      <span aria-hidden className={`wm ${shown ? 'wm-in' : 'wm-out'}`}>
         {[...'pulldasher'].map((ch, i) => (
            <span
               key={`${ch}${i}`}
               className={`wm-letter ${i >= 4 ? 'text-brand' : ''}`}
               style={{ '--i': i } as CSSProperties}
            >
               {ch}
            </span>
         ))}
      </span>
   );
}
