import { flushSync } from 'react-dom';

/** How long Undo's words wait under the pointer before they rejoin their
 * row: past a triple click. */
const HOLD_MS = 900;

/**
 * Keep what `find` returns where it is on screen through `write` (an Undo
 * that sends its row up or down the list, or changes a count or a line
 * above it, at once or when its save lands): drawn at once, and for a
 * triple click's time the page scrolls with it, so the words that replaced
 * Undo stay under the pointer and a double-click's second press lands on
 * them. Near the page's top, where there's no scrolling up, a gap above it
 * holds it, then closes. A wheel, a touch or a key lets go at once.
 * `write` gets the height the element had, for the words to keep.
 */
export function holdInPlace(find: () => HTMLElement | null, write: (held?: number) => void): void {
   const want = find()?.getBoundingClientRect().top;
   flushSync(() => write(find()?.getBoundingClientRect().height));
   if (want == null) return;
   let gapped: HTMLElement | null = null;
   let gap = 0;
   // room below, for a page too short to scroll down with it
   let room = 0;
   let done = false;
   const follow = () => {
      const el = find();
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (Math.abs(top - want) < 1) return;
      // moved down further than the page can scroll
      const canDown = document.documentElement.scrollHeight - innerHeight - scrollY;
      if (top - want > canDown) {
         room += Math.ceil(top - want - canDown);
         document.body.style.paddingBottom = `${room}px`;
      }
      window.scrollBy(0, top - want);
      // what the scroll couldn't make up (moved up, at the top)
      const short = Math.round(want - el.getBoundingClientRect().top);
      if (short < 1 && !(el === gapped && gap > 0)) return;
      if (el !== gapped) gap = 0;
      gap = Math.max(0, gap + short);
      el.style.marginTop = gap ? `${gap}px` : '';
      gapped = el;
   };
   const stop = () => {
      if (done) return;
      done = true;
      for (const type of ['wheel', 'touchmove', 'keydown']) removeEventListener(type, stop, true);
      if (room) document.body.style.paddingBottom = '';
      if (!gapped) return;
      const still = matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      gapped.style.transition = still ? '' : 'margin-top 200ms ease-out';
      gapped.style.marginTop = '';
   };
   for (const type of ['wheel', 'touchmove', 'keydown']) addEventListener(type, stop, true);
   follow();
   const start = performance.now();
   const tick = () => {
      if (done) return;
      if (performance.now() - start > HOLD_MS) return stop();
      follow();
      requestAnimationFrame(tick);
   };
   requestAnimationFrame(tick);
}
