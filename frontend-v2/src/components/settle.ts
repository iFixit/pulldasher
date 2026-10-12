import { type MutableRefObject, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

/**
 * One rule for what follows a click in the initiatives views (Decide, the
 * Roadmap's lanes and a plan's details, a project's and an initiative's
 * page, the Overview): a press near a click's point can't reach a control
 * that arrived there, or slid there, since the click. A click often
 * changes what sits under the pointer (a receipt replaces the answers, a
 * row joins a section above, Other answers opens its ends), and a
 * double-click's second press, or a "to be sure" press a second later,
 * would land on whatever came.
 *
 * A pointer click on a control inside a `PRESS_GUARD` region starts a hold
 * at its point, and notes what was under it and every control within
 * GUARD_PX and where it sat. A later press near the point is judged once,
 * at its `pointerdown`, and the verdict holds for all of its events (its
 * click too, however long it's held). It reaches nothing (no focus, no
 * selection, no click, and the control flashes an outline) when:
 *
 * - its control wasn't there, or has moved since (more than 1 px);
 * - it lands on no control, and on something other than what was there;
 * - it's the same control again within a double-click (DOUBLE_MS), unless
 *   that control is a toggle (it opens or closes something, or is
 *   pressed) or a grip that drags.
 *
 * So a control that stayed put takes every press: a toggle closed again at
 * once, the next week on the load chart, a grip's drag. The hold ends when
 * the pointer moves away, after HOLD_MS, or once the page is scrolled by a
 * person (a wheel, a key, the scrollbar, a touch pan). A pointer that
 * moved further than a wobble within it is aimed: what it lands on, it
 * means.
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

/** A double-click's span: the same control pressed again sooner is one
 * click, not two. */
export const DOUBLE_MS = 500;

/** How far a pointer moves before it's aiming, not wobbling. */
const WOBBLE_PX = 6;

const CONTROL =
   'button, a[href], summary, [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="menuitem"]';

/** What a press can land on: a control, a field or a grip. */
const TARGET = `${CONTROL}, input, select, textarea, label, [draggable="true"], [tabindex]:not([tabindex="-1"])`;

/** A control whose second press undoes its first: a double-click on it
 * does what it would anywhere. */
const TOGGLE = '[aria-expanded], [aria-pressed], [role="switch"], summary, summary *';

/** Who made a press: a person, not code's own `.click()` (opening a
 * "+ N more" on the way to a row), which starts and ends nothing. Tests
 * swap it, since jsdom makes no trusted events. */
export const pressedBy = { person: (e: Event) => e.isTrusted };

interface Hold {
   /** the press's point; null for a key's click, which holds no point */
   x: number | null;
   y: number;
   /** when the press was made */
   at: number;
   /** presses near the point are judged until then */
   until: number;
   /** the control pressed, and what was under the point */
   first: Element | null;
   under: Element | null;
   /** every control near the point then, and where it was */
   stayed: Map<Element, DOMRect>;
   /** the furthest the pointer has gone from the point */
   far: number;
   /** what goes once the pointer moves away or the next action starts */
   leave: (() => void)[];
}

let hold: Hold | null = null;

const away = (h: Hold, e: MouseEvent) =>
   h.x == null ? Infinity : Math.hypot(e.clientX - h.x, e.clientY - h.y);
const near = (h: Hold, e: MouseEvent) => away(h, e) <= GUARD_PX;

/** When a press was made, not when the page got to it: a double-click
 * made while a long render held the page is handled after it, and must
 * still count as made inside the hold. (jsdom stamps events with
 * Date.now(), another clock, so there it's now.) */
const madeAt = (e: Event) =>
   e.timeStamp > 0 && e.timeStamp <= performance.now() + 1 ? e.timeStamp : performance.now();

/** The pointer left, or a new action began: the hold and its words go. */
function leave(): void {
   const h = hold;
   hold = null;
   h?.leave.forEach(fn => fn());
}

/** The controls within GUARD_PX of a point, and where they are. */
function controlsNear(x: number, y: number): Map<Element, DOMRect> {
   const found = new Map<Element, DOMRect>();
   for (const el of document.querySelectorAll(TARGET)) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      if (Math.hypot(dx, dy) <= GUARD_PX) found.set(el, r);
   }
   return found;
}

/** Start a hold at a point (a click, a drop), or with none (a key's
 * click): the hold before it ends, as the next action. Call it before
 * the press changes anything, so it notes what was there. */
export function guardAt(
   x: number | null,
   y = 0,
   at = performance.now(),
   first: Element | null = null
): void {
   leave();
   hold = {
      x,
      y,
      at,
      until: x == null ? 0 : at + HOLD_MS,
      first,
      under: x == null ? null : document.elementFromPoint?.(x, y) ?? first,
      stayed: x == null ? new Map() : controlsNear(x, y),
      far: 0,
      leave: [],
   };
}

/** Run `fn` when the current hold ends by the pointer moving away or the
 * next action, not by the clock. */
export function onLeave(fn: () => void): void {
   hold ??= {
      x: null,
      y: 0,
      at: 0,
      until: 0,
      first: null,
      under: null,
      stayed: new Map(),
      far: 0,
      leave: [],
   };
   hold.leave.push(fn);
}

/** End the hold without running its words' leave (tests start clean). */
export function clearHolds(): void {
   hold = null;
   eating = false;
}

const moved = (a: DOMRect, b: DOMRect) =>
   Math.abs(a.left - b.left) > 1 ||
   Math.abs(a.top - b.top) > 1 ||
   Math.abs(a.width - b.width) > 1 ||
   Math.abs(a.height - b.height) > 1;

/** Whether a press at this pointerdown lands on something that came under
 * the point since the click: the rule above. */
function stray(e: MouseEvent): Element | boolean {
   const h = hold;
   if (!h || !near(h, e) || madeAt(e) >= h.until) return false;
   const target = e.target instanceof Element ? e.target : null;
   const control = target?.closest(TARGET);
   if (!control) {
      // no control: only what was there all along takes it
      const was = h.under;
      return !(target && was?.isConnected && (target.contains(was) || was.contains(target)));
   }
   const was = h.stayed.get(control);
   if (!was || moved(was, control.getBoundingClientRect()))
      return h.far > WOBBLE_PX ? false : control;
   const again =
      control === h.first &&
      madeAt(e) - h.at < DOUBLE_MS &&
      !control.matches(TOGGLE) &&
      control.getAttribute('draggable') !== 'true';
   return again ? control : false;
}

/** Outline a control a press didn't reach, a moment, so it reads as kept
 * from a stray press, not as dead. */
function flash(el: Element): void {
   const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
   const on = { outline: '2px solid var(--ring)', outlineOffset: '2px' };
   el.animate?.([on, still ? on : { ...on, outlineColor: 'transparent' }], {
      duration: 700,
      easing: 'ease-in',
   });
}

/** The verdict on the press under way, from its pointerdown. */
let eating = false;

if (typeof window !== 'undefined') {
   const listeners: [string, EventListener, AddEventListenerOptions][] = [];
   const on = <K extends keyof WindowEventMap>(
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts: AddEventListenerOptions = { capture: true }
   ) => {
      addEventListener(type, fn, opts);
      listeners.push([type, fn as EventListener, opts]);
   };
   const eat = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
   };
   const scrolled = () => {
      if (hold) hold.until = 0;
   };
   on('pointerdown', e => {
      if (!pressedBy.person(e)) return;
      // the scrollbar, outside the page's own box: a scroll on purpose
      const page = document.documentElement;
      if (e.target === page && (e.clientX >= page.clientWidth || e.clientY >= page.clientHeight))
         return scrolled();
      const verdict = stray(e);
      eating = !!verdict;
      if (verdict instanceof Element) flash(verdict);
      if (eating) return eat(e);
      // a press away from the point: the pointer moved there
      if (hold && !near(hold, e)) leave();
   });
   for (const type of ['mousedown', 'pointerup', 'mouseup', 'dblclick'] as const)
      on(type, e => {
         if (eating && pressedBy.person(e)) eat(e);
      });
   on('click', e => {
      if (!pressedBy.person(e)) return;
      // a key's click (detail 0) is never a stray press
      if (e.detail > 0 && eating) return eat(e);
      const control = (e.target as Element | null)?.closest?.(CONTROL);
      if (!control?.closest('[data-press-guard]')) return;
      guardAt(e.detail > 0 ? e.clientX : null, e.clientY, madeAt(e), control);
   });
   on(
      'pointermove',
      e => {
         if (hold?.x == null) return;
         const d = away(hold, e);
         if (d > GUARD_PX) leave();
         else hold.far = Math.max(hold.far, d);
      },
      { capture: true, passive: true }
   );
   // a person scrolls the page on purpose: what's under the pointer is seen
   on('wheel', scrolled, { capture: true, passive: true });
   on('keydown', scrolled, { capture: true, passive: true });
   on('pointercancel', scrolled, { capture: true, passive: true });
   import.meta.hot?.dispose(() => {
      for (const [type, fn, opts] of listeners) removeEventListener(type, fn, opts);
   });
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

/**
 * Ids to focus once one is drawn: set `.current`, and the first render
 * that draws one of them gives it to `found` (a receipt a write is on its
 * way to, a moved row's control). The next press or key drops it, so a
 * target that never comes (a row a find hides) can't take the focus later.
 */
export function useFocusWhenDrawn(
   found: (el: HTMLElement) => void
): MutableRefObject<string[] | null> {
   const want = useRef<string[] | null>(null);
   useEffect(() => {
      const drop = () => {
         want.current = null;
      };
      addEventListener('pointerdown', drop, true);
      addEventListener('keydown', drop, true);
      return () => {
         removeEventListener('pointerdown', drop, true);
         removeEventListener('keydown', drop, true);
      };
   }, []);
   useEffect(() => {
      const el = want.current?.map(id => document.getElementById(id)).find(Boolean);
      if (!el) return;
      want.current = null;
      found(el);
   });
   return want;
}
