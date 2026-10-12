// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { IssuePull, ProjectWork } from '../../../../shared/model/work';
import type { RowOptions } from '../../components/Row';
import { ProjectWorkSections } from './Work';

// React's act() warns unless the environment says it's a test
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pr = (number: number, over: Partial<IssuePull> = {}): IssuePull => ({
   repo: 'iFixit/ifixit',
   number,
   title: `PR ${number}`,
   author: 'dana',
   createdAt: 1_790_000_000,
   state: 'open',
   ...over,
});

// the board has read none of them, so each draws as a plain line
const page: ProjectWork = {
   issues: [
      {
         ref: { repo: 'iFixit/ifixit', number: 100 },
         title: 'Save drafts',
         state: 'open',
         closedAt: null,
         author: 'dana',
         createdAt: 1_789_000_000,
         via: ['label'],
         attachedAt: null,
         addedBy: null,
         prs: [pr(1), pr(2, { draft: true })],
         alsoIn: [],
      },
   ],
   unlinked: [pr(3), pr(4, { draft: true }), pr(5, { draft: true })],
   suggested: [],
   counts: { total: 1, open: 1, done: 0, dropped: 0, lastClosedAt: null },
};

let host: HTMLDivElement;
afterEach(() => host.remove());

function render(): HTMLDivElement {
   host = document.createElement('div');
   document.body.append(host);
   act(() =>
      createRoot(host).render(
         <ProjectWorkSections
            slug="drafts-test"
            label="project:drafts-test"
            plans={[]}
            planned={null}
            closed={null}
            page={page}
            pulls={{ live: () => undefined, known: () => undefined }}
            opts={{} as RowOptions}
            nameOf={s => s}
            navigate={() => undefined}
         />
      )
   );
   return host;
}

describe('a project’s drafts on its page', () => {
   it('sit in one closed fold at the end of its PRs, out of every stage', () => {
      const el = render();
      const folds = [...el.querySelectorAll('#project-unlinked details')];
      const labels = folds.map(f => f.querySelector('summary')?.textContent ?? '');
      expect(labels).toHaveLength(2);
      // the open one the board can't read is in development; the drafts come last
      expect(labels[0]).toMatch(/In development.*1/);
      expect(labels[1]).toMatch(/Drafts, not counted.*2/);
      expect((folds[1] as HTMLDetailsElement).open).toBe(false);
   });

   it('stay under their issue, out of its PR count', () => {
      const el = render();
      const door = el.querySelector('[data-issue] button[data-row-focus]');
      expect(door?.textContent).toContain('Show 1 PR, 1 draft');
   });
});
