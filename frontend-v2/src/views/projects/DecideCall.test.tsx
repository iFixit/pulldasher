// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import { DecideCall } from './Decide';

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

function render(opened: boolean): HTMLDivElement {
   host = document.createElement('div');
   document.body.append(host);
   const root = createRoot(host);
   act(() =>
      root.render(<DecideCall row={{ slug: null, item: plan, reasons: [] }} opened={opened} />)
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
         'Calls on Visual regression checks'
      );
      expect(el.textContent).toContain('Mark done');
      expect(el.textContent).not.toContain('Cancel');
   });
});
