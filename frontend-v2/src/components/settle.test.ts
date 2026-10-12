// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearHolds, GUARD_PX, guardAt, HOLD_MS, onLeave, reveal, settle } from './settle';

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

/** A region under the rule, with a button that counts its clicks. */
function region() {
   const root = document.createElement('div');
   root.setAttribute('data-press-guard', '');
   const first = document.createElement('button');
   const other = document.createElement('button');
   root.append(first, other);
   document.body.append(root);
   const hits = { first: 0, other: 0 };
   first.addEventListener('click', () => hits.first++);
   other.addEventListener('click', () => hits.other++);
   return { root, first, other, hits };
}

/** What a mouse sends for one press at a point, onto `el` (what's there). */
function pressAt(el: HTMLElement, x: number, y: number, detail = 1) {
   const at = { bubbles: true, cancelable: true, clientX: x, clientY: y };
   const down = new MouseEvent('pointerdown', at);
   el.dispatchEvent(down);
   el.dispatchEvent(new MouseEvent('mousedown', at));
   el.dispatchEvent(new MouseEvent('mouseup', at));
   el.dispatchEvent(new MouseEvent('click', { ...at, detail }));
   return down;
}

const moveTo = (x: number, y: number) =>
   document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));

let now = 1000;
beforeEach(() => {
   now = 1000;
   vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
   clearHolds();
   document.body.innerHTML = '';
   vi.restoreAllMocks();
});

describe('the press guard', () => {
   it('lets no press at a click’s point reach what slid there', () => {
      const { first, other, hits } = region();
      pressAt(first, 100, 100);
      expect(hits.first).toBe(1);
      // the click moved `other` under the pointer: a double-click's second
      // press finds it, and reaches nothing
      const down = pressAt(other, 100 + GUARD_PX - 2, 100);
      expect(hits.other).toBe(0);
      // nothing takes the focus or starts a selection either
      expect(down.defaultPrevented).toBe(true);
      // the same control again, too: a triple click is one click
      pressAt(first, 100, 100);
      expect(hits.first).toBe(1);
   });

   it('lets a press away from the point through', () => {
      const { first, other, hits } = region();
      pressAt(first, 100, 100);
      pressAt(other, 100 + GUARD_PX + 2, 100);
      expect(hits.other).toBe(1);
   });

   it('ends once the pointer moves away, and not for a wobble', () => {
      const { first, other, hits } = region();
      pressAt(first, 100, 100);
      moveTo(103, 98);
      pressAt(other, 100, 100);
      expect(hits.other).toBe(0);
      moveTo(100, 100 + GUARD_PX + 1);
      pressAt(other, 100, 100);
      expect(hits.other).toBe(1);
   });

   it('lets go after its time with the pointer still, and no sooner', () => {
      const { first, other, hits } = region();
      pressAt(first, 100, 100);
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

   it('lets go on a wheel: the page moved on purpose', () => {
      const { first, other, hits } = region();
      pressAt(first, 100, 100);
      document.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }));
      pressAt(other, 100, 100);
      expect(hits.other).toBe(1);
   });

   it('holds nothing for a key’s click, or outside its regions', () => {
      const { first, other, hits } = region();
      pressAt(first, 100, 100, 0);
      pressAt(other, 100, 100);
      expect(hits.other).toBe(1);
      const outside = document.createElement('button');
      document.body.append(outside);
      let outsideHits = 0;
      outside.addEventListener('click', () => outsideHits++);
      pressAt(outside, 300, 300);
      pressAt(outside, 300, 300);
      expect(outsideHits).toBe(2);
   });

   it('lets code’s own click (opening a "+ N more") start nothing and end nothing', () => {
      // outside tests, only a person's press counts: jsdom makes no trusted ones
      vi.stubEnv('MODE', 'production');
      try {
         const { first, other, hits } = region();
         guardAt(100, 100);
         const gone = vi.fn();
         onLeave(gone);
         first.click();
         expect(hits.first).toBe(1);
         expect(gone).not.toHaveBeenCalled();
         const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 });
         other.dispatchEvent(down);
         expect(down.defaultPrevented).toBe(true);
      } finally {
         vi.unstubAllEnvs();
      }
   });

   it('holds at a drop’s point', () => {
      const { other, hits } = region();
      guardAt(50, 60);
      pressAt(other, 52, 61);
      expect(hits.other).toBe(0);
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
