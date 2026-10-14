// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import RangeCalendar from './RangeCalendar';
import { dayOf } from '../../model/projectData';

// React's act() warns unless the environment says it's a test
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
   act(() => root?.unmount());
   root = null;
   document.body.innerHTML = '';
});

function draw(props: Partial<Parameters<typeof RangeCalendar>[0]>) {
   window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
   const el = document.createElement('div');
   document.body.append(el);
   root = createRoot(el);
   const t = new Date();
   const range = { start: dayOf(t), end: dayOf(t) };
   act(() => root?.render(<RangeCalendar range={range} onApply={() => undefined} {...props} />));
   return el;
}

// two months ahead, which a roadmap can pick and Look back can't
const ahead = new Date(new Date().getFullYear(), new Date().getMonth() + 2, 1);
const aheadRange = {
   start: dayOf(ahead),
   end: dayOf(new Date(ahead.getFullYear(), ahead.getMonth(), 20)),
};
const caption = (el: HTMLElement) => el.querySelector('.rdp-caption_label')?.textContent ?? '';
const monthName = ahead.toLocaleDateString(undefined, { month: 'long' });
const days = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('td button')];

describe('RangeCalendar', () => {
   it('never opens on months ahead for looking back', () => {
      expect(caption(draw({ range: aheadRange }))).not.toContain(monthName);
   });

   it('opens the roadmap on its first month ahead, every day open to pick', () => {
      const el = draw({
         range: aheadRange,
         future: true,
         words: () => 'Oct 2026, in whole months',
      });
      expect(caption(el)).toContain(monthName);
      expect(days(el).length).toBeGreaterThan(27);
      expect(days(el).every(b => !b.disabled)).toBe(true);
      expect(el.textContent).toContain('Oct 2026, in whole months');
   });
});
