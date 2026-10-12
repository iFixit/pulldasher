import { flushSync } from 'react-dom';

/**
 * One rule for what follows a click in the initiatives views (Decide, the
 * Roadmap and a plan's details, a project's and an initiative's page, the
 * Overview): nothing new can be clicked where the pointer is until it
 * moves. A click there often changes what sits under the pointer (a
 * receipt replaces the answers, a row joins a section above, a lane
 * opens), and a double-click's second press, or a "to be sure" press a
 * second later, would land on whatever slid there.
 *
 * A pointer click on a control inside a `PRESS_GUARD` region starts a hold
 * at its point. While it lasts, a press within GUARD_PX of that point
 * reaches nothing: no focus, no selection, no click. It lasts until the
 * pointer moves away or a wheel scrolls, or HOLD_MS with the pointer
 * still. Nothing is drawn and nothing waits on a timer: each press checks.
 *
 * What the click left (a receipt, Undo's words) is put where it can be
 * seen with `settle` or `reveal`, below the sticky headers, and the caller
 * gives it the focus. Words that stand in for a control a while (Decide's
 * "Put X back") go with `onLeave`: when the pointer moves away, or the
 * next action starts, never on the clock.
 */

/** The attribute that puts a region under the rule. */
export const PRESS_GUARD = { 'data-press-guard': '' } as const;

/** How far the pointer can drift from the press and still be still: a
 * hand's wobble through a double or triple click. */
export const GUARD_PX = 24;

/** How long a pointer that never moves is held: past a triple click and a
 * second press "to be sure". */
export const HOLD_MS = 1600;

const CONTROL =
   'button, a[href], summary, [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="menuitem"]';

interface Hold {
   /** the press's point; null for a key's click, which holds no point */
   x: number | null;
   y: number;
   /** presses near the point reach nothing until then */
   until: number;
   /** what goes once the pointer moves away or the next action starts */
   leave: (() => void)[];
}

let hold: Hold | null = null;

const near = (h: Hold, e: MouseEvent) =>
   h.x != null && Math.hypot(e.clientX - h.x, e.clientY - h.y) <= GUARD_PX;

/** When a press was made, not when the page got to it: a double-click
 * made while a long render held the page is handled after it, and must
 * still count as made inside the hold. (jsdom stamps events with
 * Date.now(), another clock, so there it's now.) */
const madeAt = (e: Event) =>
   e.timeStamp > 0 && e.timeStamp <= performance.now() + 1 ? e.timeStamp : performance.now();

const guarding = (e: MouseEvent) => !!hold && near(hold, e) && madeAt(e) < hold.until;

/** The pointer left, or a new action began: the hold and its words go. */
function leave(): void {
   const h = hold;
   hold = null;
   h?.leave.forEach(fn => fn());
}

/** Start a hold at a point (a click, a drop), or with none (a key's
 * click): the hold before it ends, as the next action. */
export function guardAt(x: number | null, y = 0, at = performance.now()): void {
   leave();
   hold = { x, y, until: x == null ? 0 : at + HOLD_MS, leave: [] };
}

/** Run `fn` when the current hold ends by the pointer moving away or the
 * next action, not by the clock. */
export function onLeave(fn: () => void): void {
   hold ??= { x: null, y: 0, until: 0, leave: [] };
   hold.leave.push(fn);
}

/** End the hold without running its words' leave (tests start clean). */
export function clearHolds(): void {
   hold = null;
}

/** A press a person made: code's own `.click()` (opening a "+ N more"
 * on the way to a row) is no action and starts no hold. jsdom makes no
 * trusted events, so tests count every one. */
const real = (e: Event) => e.isTrusted || import.meta.env.MODE === 'test';

if (typeof window !== 'undefined') {
   const eat = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
   };
   const press = (e: MouseEvent) => {
      if (guarding(e)) return eat(e);
      // a press away from the point: the pointer moved there
      if (hold && e.type === 'pointerdown' && !near(hold, e)) leave();
   };
   for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick'])
      addEventListener(type, press as EventListener, true);
   addEventListener(
      'click',
      e => {
         if (!real(e)) return;
         // a key's click (detail 0) is never a stray press
         if (e.detail > 0 && guarding(e)) return eat(e);
         const control = (e.target as Element | null)?.closest?.(CONTROL);
         if (!control?.closest('[data-press-guard]')) return;
         guardAt(e.detail > 0 ? e.clientX : null, e.clientY, madeAt(e));
      },
      true
   );
   addEventListener(
      'pointermove',
      e => {
         if (hold?.x != null && !near(hold, e)) leave();
      },
      { capture: true, passive: true }
   );
   // a scroll moves the page on purpose: what's under the pointer is seen
   addEventListener(
      'wheel',
      () => {
         if (hold) hold.until = 0;
      },
      { capture: true, passive: true }
   );
}

/** Space kept between what's revealed and an edge or a sticky header. */
const MARGIN = 8;

/** How far down the window the stuck headers reach over `left..right`,
 * leaving out any that hold the elements themselves. */
function coveredTo(els: HTMLElement[], left: number, right: number): number {
   let under = 0;
   for (const s of document.querySelectorAll<HTMLElement>('[class*="sticky"], .fixed')) {
      if (els.some(e => s.contains(e))) continue;
      const style = getComputedStyle(s);
      if (style.position !== 'sticky' && style.position !== 'fixed') continue;
      const r = s.getBoundingClientRect();
      if (!r.height || r.height > innerHeight / 2 || r.right <= left || r.left >= right) continue;
      // stuck at its top, not sitting in the flow lower down
      const at = parseFloat(style.top);
      if (Number.isNaN(at) || Math.abs(r.top - at) > 1) continue;
      under = Math.max(under, r.bottom);
   }
   return under;
}

/**
 * Scroll the least that shows every element whole, below the sticky
 * headers and above the window's bottom (the top wins when they can't
 * both fit). A header that sticks once it scrolls (a lane's) counts on the
 * next pass.
 */
export function reveal(...els: (HTMLElement | null | undefined)[]): void {
   for (let pass = 0; pass < 3; pass++) {
      const shown = els.filter((e): e is HTMLElement => !!e?.isConnected);
      const rects = shown.map(e => e.getBoundingClientRect()).filter(r => r.width || r.height);
      if (!rects.length) return;
      const top = Math.min(...rects.map(r => r.top));
      const bottom = Math.max(...rects.map(r => r.bottom));
      const under = coveredTo(
         shown,
         Math.min(...rects.map(r => r.left)),
         Math.max(...rects.map(r => r.right))
      );
      const dy =
         top < under + MARGIN
            ? top - under - MARGIN
            : bottom > innerHeight - MARGIN
            ? Math.min(bottom - innerHeight + MARGIN, top - under - MARGIN)
            : 0;
      if (Math.abs(dy) < 1) return;
      window.scrollBy(0, dy);
   }
}

/** Focus what a click left, without the browser's own scroll (which knows
 * nothing of sticky headers), and show it, with `also` beside it. */
export function focusResult(
   el: HTMLElement | null | undefined,
   ...also: (HTMLElement | null | undefined)[]
): void {
   el?.focus({ preventScroll: true });
   reveal(el, ...also);
}

/**
 * Write a change that moves what `find` returns (an Undo that sends its
 * row up or down, or changes a line above it), drawn at once, then scroll
 * once so it stays where it was on screen, and show it whole. `write` gets
 * the height it had, for the words that replace it to keep. `leaving` runs
 * when the pointer moves away or the next action starts.
 */
export function settle(
   find: () => HTMLElement | null,
   write: (held?: number) => void,
   leaving?: () => void
): void {
   const before = find()?.getBoundingClientRect();
   flushSync(() => write(before?.height));
   if (leaving) onLeave(leaving);
   const after = find();
   if (!after) return;
   const moved = before ? after.getBoundingClientRect().top - before.top : 0;
   if (Math.abs(moved) >= 1) window.scrollBy(0, moved);
   reveal(after);
}
