// @vitest-environment jsdom
import { act, createElement, type MutableRefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
   clearHolds,
   DOUBLE_MS,
   GUARD_PX,
   guardAt,
   HOLD_MS,
   onLeave,
   pressedBy,
   reveal,
   settle,
   useFocusWhenDrawn,
} from './settle';

// jsdom makes no trusted events: every press here is a person's
pressedBy.person = () => true;

const box = (top: number, height: number, left = 0, width = 400) =>
   ({
      top,
      bottom: top + height,
      left,
      right: left + width,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
   } as DOMRect);

/** Put an element at a place on screen: what its rect says. */
const place = (el: HTMLElement, left: number, top: number, width = 40, height = 20) => {
   el.getBoundingClientRect = () => box(top, height, left, width);
};

/** A region under the rule, with two buttons that count their clicks:
 * `first` around (100, 100), `other` far away until a test moves it. */
function region() {
   const root = document.createElement('div');
   root.setAttribute('data-press-guard', '');
   const first = document.createElement('button');
   const other = document.createElement('button');
   root.append(first, other);
   document.body.append(root);
   place(first, 80, 90);
   place(other, 400, 400);
   const hits = { first: 0, other: 0 };
   first.addEventListener('click', () => hits.first++);
   other.addEventListener('click', () => hits.other++);
   return { root, first, other, hits };
}

/** What a mouse sends for one press at a point, onto `el` (what's there). */
function pressAt(el: Element, x: number, y: number, detail = 1) {
   const at = { bubbles: true, cancelable: true, clientX: x, clientY: y };
   const down = new MouseEvent('pointerdown', at);
   el.dispatchEvent(down);
   const mouse = new MouseEvent('mousedown', at);
   el.dispatchEvent(mouse);
   el.dispatchEvent(new MouseEvent('mouseup', at));
   el.dispatchEvent(new MouseEvent('click', { ...at, detail }));
   return { down, mouse };
}

const moveTo = (x: number, y: number) =>
   document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));

let now = 1000;
let flashed: Element[] = [];
beforeEach(() => {
   now = 1000;
   vi.spyOn(performance, 'now').mockImplementation(() => now);
   flashed = [];
   Element.prototype.animate = function (this: Element) {
      flashed.push(this);
      return {} as Animation;
   };
   // the page's own box, so a press at a point isn't on its scrollbar
   vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000);
   vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);
});
afterEach(() => {
   clearHolds();
   document.body.innerHTML = '';
   vi.restoreAllMocks();
   delete (Element.prototype as Partial<Element>).animate;
});

describe('the press guard: a stray press', () => {
   it('reaches no control that arrived under the point since the click', () => {
      const { root, first, hits } = region();
      pressAt(first, 100, 100);
      expect(hits.first).toBe(1);
      // the click put a new control where the pointer is: a double-click's
      // second press finds it, and reaches nothing
      const came = document.createElement('button');
      place(came, 85, 92);
      root.append(came);
      let cameHits = 0;
      came.addEventListener('click', () => cameHits++);
      const { down, mouse } = pressAt(came, 101, 100);
      expect(cameHits).toBe(0);
      // nothing takes the focus or starts a selection either, and the
      // control says it was kept from the press
      expect(down.defaultPrevented).toBe(true);
      expect(mouse.defaultPrevented).toBe(true);
      expect(flashed).toEqual([came]);
   });

   it('reaches no control that slid under the point', () => {
      const { first, other, hits } = region();
      pressAt(first, 100, 100);
      place(other, 90, 95);
      pressAt(other, 100 + GUARD_PX - 4, 100);
      expect(hits.other).toBe(0);
   });

   it('reaches no control that moved, though it was near', () => {
      const { first, other, hits } = region();
      place(other, 125, 90);
      pressAt(first, 100, 100);
      // a line above it grew: it slid down 18 px, still near the point
      place(other, 125, 108);
      pressAt(other, 118, 112);
      expect(hits.other).toBe(0);
   });

   it('takes a double-click on one control as one click', () => {
      const { first, hits } = region();
      pressAt(first, 100, 100);
      now += DOUBLE_MS - 100;
      pressAt(first, 100, 100);
      expect(hits.first).toBe(1);
   });

   it('eats the click of a press it ate, however long the press is held', () => {
      const { root, first } = region();
      pressAt(first, 100, 100);
      const came = document.createElement('button');
      place(came, 85, 92);
      root.append(came);
      let cameHits = 0;
      came.addEventListener('click', () => cameHits++);
      const at = { bubbles: true, cancelable: true, clientX: 100, clientY: 100 };
      now += HOLD_MS - 200;
      came.dispatchEvent(new MouseEvent('pointerdown', at));
      // held down past the hold's end, then let go
      now += 600;
      came.dispatchEvent(new MouseEvent('mouseup', at));
      came.dispatchEvent(new MouseEvent('click', { ...at, detail: 1 }));
      expect(cameHits).toBe(0);
   });

   it('reaches nothing new where no control is, so nothing that came is selected', () => {
      const { root, first } = region();
      pressAt(first, 100, 100);
      first.remove();
      const words = document.createElement('span');
      root.append(words);
      const { down } = pressAt(words, 100, 100);
      expect(down.defaultPrevented).toBe(true);
   });

   it('holds at a drop’s point', () => {
      const { root, hits, other } = region();
      guardAt(50, 60);
      place(other, 40, 50);
      pressAt(other, 52, 61);
      expect(hits.other).toBe(0);
      const came = document.createElement('button');
      root.append(came);
      place(came, 45, 55);
      pressAt(came, 52, 61);
      expect(flashed).toEqual([other, came]);
   });

   it('judges a press by when it was made, not when a busy page got to it', () => {
      const { first, hits } = region();
      pressAt(first, 100, 100);
      // a long render: the page reads the second press of a double-click
      // two seconds on, though it was made a moment after the first
      now += 2000;
      const at = { bubbles: true, cancelable: true, clientX: 100, clientY: 100 };
      const down = new MouseEvent('pointerdown', at);
      Object.defineProperty(down, 'timeStamp', { value: 1080 });
      first.dispatchEvent(down);
      first.dispatchEvent(new MouseEvent('click', { ...at, detail: 2 }));
      expect(hits.first).toBe(1);
   });
});

describe('the press guard: a press a person means', () => {
   it('reaches a neighbour that stayed in place, at once', () => {
      const { first, other, hits } = region();
      place(other, 122, 90, 12, 20);
      pressAt(first, 100, 100);
      now += 200;
      pressAt(other, 116 + 12, 100);
      expect(hits.other).toBe(1);
      expect(flashed).toEqual([]);
   });

   it('reaches the same control again after a double-click’s span', () => {
      const { first, hits } = region();
      pressAt(first, 100, 100);
      now += DOUBLE_MS + 1;
      pressAt(first, 100, 100);
      expect(hits.first).toBe(2);
   });

   it('closes a toggle it just opened, at 0.4 s or at once', () => {
      const { first, hits } = region();
      first.setAttribute('aria-expanded', 'false');
      first.addEventListener('click', () =>
         first.setAttribute('aria-expanded', String(first.getAttribute('aria-expanded') !== 'true'))
      );
      pressAt(first, 100, 100);
      now += 400;
      pressAt(first, 100, 100);
      expect(first.getAttribute('aria-expanded')).toBe('false');
      pressAt(first, 100, 100);
      expect(hits.first).toBe(3);
      // a fold's band: a summary, or what's inside one
      const fold = document.createElement('details');
      const band = document.createElement('summary');
      const label = document.createElement('button');
      band.append(label);
      fold.append(band);
      first.closest('[data-press-guard]')?.append(fold);
      place(label, 300, 300);
      let labelHits = 0;
      label.addEventListener('click', () => labelHits++);
      pressAt(label, 310, 310);
      pressAt(label, 310, 310);
      expect(labelHits).toBe(2);
   });

   it('never cancels a drag from a grip that stayed put', () => {
      const { first } = region();
      first.setAttribute('draggable', 'true');
      pressAt(first, 100, 100);
      now += 200;
      const { down, mouse } = pressAt(first, 100, 100);
      expect(down.defaultPrevented).toBe(false);
      expect(mouse.defaultPrevented).toBe(false);
   });

   it('reaches a control the pointer moved onto, past a wobble', () => {
      const { root, first } = region();
      pressAt(first, 100, 100);
      // Other answers opened its ends 12 px below the pointer
      const end = document.createElement('button');
      place(end, 80, 108);
      root.append(end);
      let endHits = 0;
      end.addEventListener('click', () => endHits++);
      moveTo(102, 104);
      pressAt(end, 102, 104);
      expect(endHits).toBe(0);
      moveTo(100, 112);
      pressAt(end, 100, 112);
      expect(endHits).toBe(1);
   });

   it('reaches what the pointer moved away to', () => {
      const { first, other, hits } = region();
      place(other, 140, 90);
      pressAt(first, 100, 100);
      pressAt(other, 100 + GUARD_PX + 26, 100);
      expect(hits.other).toBe(1);
   });

   it('reaches a key’s press always, and holds nothing outside its regions', () => {
      const { root, first } = region();
      pressAt(first, 100, 100, 0);
      const came = document.createElement('button');
      place(came, 85, 92);
      root.append(came);
      let cameHits = 0;
      came.addEventListener('click', () => cameHits++);
      pressAt(came, 100, 100);
      expect(cameHits).toBe(1);
      clearHolds();
      const outside = document.createElement('button');
      document.body.append(outside);
      place(outside, 280, 290);
      let outsideHits = 0;
      outside.addEventListener('click', () => outsideHits++);
      pressAt(outside, 300, 300);
      outside.remove();
      const next = document.createElement('button');
      document.body.append(next);
      place(next, 280, 290);
      next.addEventListener('click', () => outsideHits++);
      pressAt(next, 300, 300);
      expect(outsideHits).toBe(2);
   });

   it('lets code’s own click (opening a "+ N more") start nothing and end nothing', () => {
      const person = pressedBy.person;
      pressedBy.person = e => e.isTrusted;
      try {
         const { first, other } = region();
         guardAt(100, 100);
         const gone = vi.fn();
         onLeave(gone);
         first.click();
         expect(gone).not.toHaveBeenCalled();
         // the hold is still the drop's: what came is still kept from a press
         pressedBy.person = person;
         place(other, 90, 95);
         const { down } = pressAt(other, 100, 100);
         expect(down.defaultPrevented).toBe(true);
      } finally {
         pressedBy.person = person;
      }
   });
});

describe('the press guard lets go', () => {
   /** A click on `first`, then a control that slid under the point. */
   const slid = () => {
      const r = region();
      pressAt(r.first, 100, 100);
      place(r.other, 90, 95);
      return r;
   };

   it('once the pointer moves away, and not for a wobble', () => {
      const { other, hits } = slid();
      moveTo(103, 98);
      pressAt(other, 100, 100);
      expect(hits.other).toBe(0);
      moveTo(100, 100 + GUARD_PX + 1);
      pressAt(other, 100, 100);
      expect(hits.other).toBe(1);
   });

   it('after its time with the pointer still, and no sooner', () => {
      const { other, hits } = slid();
      now += HOLD_MS - 1;
      pressAt(other, 100, 100);
      expect(hits.other).toBe(0);
      now += 2;
      pressAt(other, 100, 100);
      expect(hits.other).toBe(1);
   });

   it('holds at least a second and a half', () => {
      expect(HOLD_MS).toBeGreaterThanOrEqual(1500);
   });

   it.each([
      [
         'a wheel',
         () => document.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })),
      ],
      [
         'a key',
         () =>
            document.dispatchEvent(
               new KeyboardEvent('keydown', { bubbles: true, key: 'PageDown' })
            ),
      ],
      [
         'a touch pan',
         () => document.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true })),
      ],
      [
         'the scrollbar',
         () =>
            document.documentElement.dispatchEvent(
               new MouseEvent('pointerdown', { bubbles: true, clientX: 1005, clientY: 100 })
            ),
      ],
   ])('once %s scrolls the page', (_how, scroll) => {
      const { other, hits } = slid();
      scroll();
      pressAt(other, 100, 100);
      expect(hits.other).toBe(1);
   });
});

describe('words held after a click', () => {
   it('go when the pointer moves away, not on the clock', () => {
      const { first } = region();
      pressAt(first, 100, 100);
      const gone = vi.fn();
      onLeave(gone);
      now += HOLD_MS * 3;
      moveTo(101, 101);
      expect(gone).not.toHaveBeenCalled();
      moveTo(200, 200);
      expect(gone).toHaveBeenCalledTimes(1);
   });

   it('go when the next action starts, by key or by a press elsewhere', () => {
      const { first, other } = region();
      pressAt(first, 100, 100);
      const gone = vi.fn();
      onLeave(gone);
      pressAt(other, 100, 100, 0);
      expect(gone).toHaveBeenCalledTimes(1);
      // after a key's Undo, a press anywhere is the next action
      const again = vi.fn();
      onLeave(again);
      moveTo(500, 500);
      expect(again).not.toHaveBeenCalled();
      pressAt(document.body, 500, 500);
      expect(again).toHaveBeenCalledTimes(1);
   });
});

describe('reveal', () => {
   let scrolled: number[];
   // how far the page has scrolled: what isn't stuck moves up by it
   let offset = 0;
   beforeEach(() => {
      scrolled = [];
      offset = 0;
      vi.spyOn(window, 'scrollBy').mockImplementation(((_x: number, y: number) => {
         scrolled.push(y);
         offset += y;
      }) as typeof window.scrollBy);
   });

   const header = (top: number, height: number) => {
      const h = document.createElement('div');
      h.className = 'sticky';
      h.style.position = 'sticky';
      h.style.top = `${top}px`;
      h.getBoundingClientRect = () => box(top, height);
      document.body.append(h);
      return h;
   };
   const at = (top: number, height = 30) => {
      const el = document.createElement('div');
      el.getBoundingClientRect = () => box(top - offset, height);
      document.body.append(el);
      return el;
   };

   it('brings what hides under the stuck headers out below them', () => {
      header(0, 48);
      header(48, 40);
      reveal(at(60));
      expect(scrolled).toEqual([60 - 88 - 8]);
   });

   it('leaves a header that isn’t stuck out of the sum', () => {
      // sticky at 0, but sitting lower in the flow: not over anything
      const lower = document.createElement('div');
      lower.className = 'sticky';
      lower.style.position = 'sticky';
      lower.style.top = '0px';
      lower.getBoundingClientRect = () => box(300, 40);
      document.body.append(lower);
      reveal(at(100));
      expect(scrolled).toEqual([]);
   });

   it('brings what’s past the window’s bottom up', () => {
      reveal(at(innerHeight - 10));
      expect(scrolled).toEqual([30 - 10 + 8]);
   });

   it('does nothing to what’s in view', () => {
      header(0, 48);
      reveal(at(200));
      expect(scrolled).toEqual([]);
   });
});

describe('settle', () => {
   it('keeps the element where it was, every time, leaving no style behind', () => {
      const scrolled: number[] = [];
      vi.spyOn(window, 'scrollBy').mockImplementation(((_x: number, y: number) =>
         scrolled.push(y)) as unknown as typeof window.scrollBy);
      const el = document.createElement('div');
      document.body.append(el);
      let top = 300;
      el.getBoundingClientRect = () => box(top, 30);
      const held: (number | undefined)[] = [];
      // an Undo that sends its row up 60 px, twice on one element
      for (let k = 0; k < 2; k++) {
         settle(
            () => el,
            h => {
               held.push(h);
               top -= 60;
            }
         );
         top += 60; // the scroll put it back
      }
      expect(held).toEqual([30, 30]);
      expect(scrolled).toEqual([-60, -60]);
      expect(el.getAttribute('style')).toBeNull();
      expect(document.body.getAttribute('style')).toBeNull();
   });
});

describe('a focus that waits for its target', () => {
   (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

   /** A view that draws a button with the id `drawn` names, and asks for it. */
   function mount() {
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      let want: MutableRefObject<string[] | null> = { current: null };
      const found: HTMLElement[] = [];
      function View({ drawn }: { drawn: string | null }) {
         want = useFocusWhenDrawn(el => found.push(el));
         return drawn ? createElement('button', { id: drawn }) : null;
      }
      const draw = (drawn: string | null) => act(() => root.render(createElement(View, { drawn })));
      draw(null);
      return { want: () => want, found, draw, done: () => act(() => root.unmount()) };
   }

   it('gives the focus to it once a render draws it', () => {
      const v = mount();
      v.want().current = ['later'];
      v.draw(null);
      expect(v.found).toEqual([]);
      v.draw('later');
      expect(v.found.map(e => e.id)).toEqual(['later']);
      v.done();
   });

   it('drops it at the next press or key, so it never comes late', () => {
      const v = mount();
      v.want().current = ['later'];
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'j' }));
      v.draw('later');
      v.want().current = ['again'];
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      v.draw('again');
      expect(v.found).toEqual([]);
      v.done();
   });
});
