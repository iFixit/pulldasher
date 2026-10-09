// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { DecideReason } from '../../../../shared/model/decide';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import type { DecideRow } from '../../../../shared/model/decide';
import { askAll, bulkWords, type Call, DecideCall, sharedAsk } from './Decide';

// React's act() warns unless the environment says it's a test
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan: RoadmapItem = {
   id: 9,
   name: 'Visual regression checks',
   project: null,
   team: 'FixBot',
   lead: 'ardelato',
   status: 'active',
   origin: null,
   start: '2026-09-07',
   weeks: 6,
   // a commitment, the end these tests ask about
   end_kind: 'hard',
   done_when: '',
   priority: 8,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: null,
   created_at: null,
   update: null,
};

let host: HTMLDivElement | null = null;
afterEach(() => {
   host?.remove();
   host = null;
});

function render(opened: boolean, reasons: DecideReason[] = [], compact = false): HTMLDivElement {
   host = document.createElement('div');
   document.body.append(host);
   const root = createRoot(host);
   act(() =>
      root.render(
         <DecideCall row={{ slug: null, item: plan, reasons }} opened={opened} compact={compact} />
      )
   );
   return host;
}

describe('the calls on a plan nobody asked about', () => {
   it('rest behind Change where they sit beside the plan’s words', () => {
      const el = render(false);
      expect(el.querySelector('[role="toolbar"]')).toBeNull();
      expect(el.textContent).toContain('Change');
   });

   it('stand open, with no Cancel, where someone opened the plan to change it', () => {
      const el = render(true);
      expect(el.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe(
         'Decisions for Visual regression checks'
      );
      expect(el.textContent).toContain('Mark done');
      expect(el.textContent).not.toContain('Cancel');
   });
});

describe('the calls on a row Decide asks about', () => {
   const done: DecideReason[] = [{ kind: 'issues_done', done: 2, dropped: 0, open: 0 }];
   const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')].map(b => b.textContent);

   it('start as the suggested answer and Other answers', () => {
      const el = render(false, done);
      expect(buttons(el)).toEqual(['Mark doneSuggested', 'Other answers']);
   });

   it('open every answer in place from Other answers', () => {
      const el = render(false, done);
      const other = [...el.querySelectorAll('button')].find(b => b.textContent === 'Other answers');
      act(() => other?.click());
      expect(el.textContent).toContain('Promise to finish by');
      expect(buttons(el)).toEqual(expect.arrayContaining(['Park', 'Drop', 'Mark doneSuggested']));
   });

   it('stand open where someone opened the plan to change it', () => {
      const el = render(true, done);
      expect(el.textContent).toContain('Or instead');
      expect(el.textContent).not.toContain('Other answers');
   });
});

describe('a section whose rows all ask the same thing', () => {
   const stalled = (slug: string, days: number): DecideRow => ({
      slug,
      item: null,
      reasons: [{ kind: 'stalled', days }],
   });
   const none = () => undefined;

   it('asks once, in the plural, when every row has the same answer', () => {
      const rows = [stalled('a', 268), stalled('b', 99)];
      expect(sharedAsk(rows, none, '2026-10-09')).toBe('Park it for now?');
      expect(askAll('Park it for now?')).toBe('Park them for now?');
      expect(askAll('When will it finish?')).toBe('When will each finish?');
      expect(askAll('Mark the plan done too?')).toBe('Mark the plans done too?');
   });

   it('keeps the cards for one row, differing answers, or a row with more to say', () => {
      expect(sharedAsk([stalled('a', 268)], none, '2026-10-09')).toBeNull();
      const done: DecideRow = {
         slug: null,
         item: plan,
         reasons: [{ kind: 'issues_done', done: 2, dropped: 0, open: 0 }],
      };
      expect(sharedAsk([stalled('a', 268), done], none, '2026-10-09')).toBeNull();
      const twice: DecideRow = {
         ...stalled('b', 99),
         reasons: [...stalled('b', 99).reasons, { kind: 'at_risk' }],
      };
      expect(sharedAsk([stalled('a', 268), twice], none, '2026-10-09')).toBeNull();
   });

   it('says the day the rows’ own buttons say', () => {
      const oct: Call = {
         kind: 'commit',
         label: 'End of Oct',
         end: '2026-10-31',
         through: 'the end of Oct',
      };
      expect(bulkWords(Array<Call>(7).fill(oct), 'do')).toBe('Promise all 7 by Oct 31');
   });

   it('gives each row an outlined answer, unmarked, and every other answer a click away', () => {
      const el = render(false, [{ kind: 'issues_done', done: 2, dropped: 0, open: 0 }], true);
      const buttons = () => [...el.querySelectorAll('button')];
      expect(buttons().map(b => b.textContent)).toEqual(['Mark done', 'Other answers']);
      expect(buttons()[0].className).not.toContain('bg-brand');
      expect(buttons()[0].getAttribute('aria-label')).toBe('Mark Visual regression checks done');
      act(() => buttons()[1].click());
      expect(buttons().map(b => b.textContent)).toEqual(
         expect.arrayContaining(['Park', 'Drop', 'Mark doneSuggested'])
      );
   });
});
