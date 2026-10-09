// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { derive, type DerivedPull } from '../../../shared/model/status';
import type { PullData } from '../../../shared/types';
import { JailMode } from './JailMode';

// React's act() warns unless the environment says it's a test
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let n = 0;
/** One of my open PRs, run through the real derive; `ready` waives CR and
 * QA so it can merge now, otherwise it waits on CR. */
const pull = (ageDays = 1, { ready = false } = {}): DerivedPull => {
   n += 1;
   const at = new Date(Date.now() - ageDays * 86400_000 - 60_000).toISOString();
   const data: PullData = {
      repo: 'iFixit/ifixit',
      number: n,
      state: 'open',
      title: `PR ${n}`,
      body: '',
      draft: false,
      created_at: at,
      updated_at: at,
      closed_at: null,
      merged_at: null,
      mergeable: true,
      difficulty: null,
      additions: 10,
      deletions: 5,
      changed_files: 2,
      milestone: { title: null, due_on: null },
      head: { ref: 'branch', sha: 'abc', repo: { owner: { login: 'iFixit' } } },
      base: { ref: 'master' },
      user: { login: 'me' },
      status: {
         cr_req: ready ? 0 : 1,
         qa_req: ready ? 0 : 1,
         allCR: [],
         allQA: [],
         dev_block: [],
         deploy_block: [],
         commit_statuses: [],
      },
      labels: [],
      participants: [],
   };
   return derive(data, undefined);
};
const many = (count: number) => Array.from({ length: count }, () => pull());

let root: Root | null = null;
const host = document.createElement('div');
document.body.append(host);
afterEach(() => {
   act(() => root?.unmount());
   root = null;
   localStorage.clear();
});

function render(pulls: DerivedPull[]) {
   const r = (root ??= createRoot(host));
   act(() => r.render(<JailMode pulls={pulls} me="me" extraBots={new Set()} initialized />));
}

const why = () => document.getElementById('jail-why')?.textContent;
const listed = () => document.querySelectorAll('[role="dialog"] li').length;
const headers = () => [...document.querySelectorAll('[role="dialog"] h3')].map(h => h.textContent);

describe('JailMode while the cell is down', () => {
   it('follows new PRs and merges live', () => {
      const first = many(8);
      render(first);
      expect(why()).toMatch(/^8 open PRs/);
      expect(listed()).toBe(8);

      // a new PR arrives over the socket
      render([...first, pull()]);
      expect(why()).toMatch(/^9 open PRs/);
      expect(listed()).toBe(9);

      // merges bring you under the limits: the cell says so
      render(first.slice(0, 3));
      expect(why()).toMatch(/under the limits/);
      expect(listed()).toBe(0);
   });

   it('lifts ready PRs to the top and counts them in the why line', () => {
      const ready = pull(2, { ready: true });
      render([...many(7), ready]);
      expect(headers()).toEqual(['Ready to merge · 1', 'Waiting on others · 7']);
      expect(document.querySelector('[role="dialog"] li a')?.textContent).toContain(
         ready.data.title
      );
      expect(why()).toBe('8 open PRs. Parole at 7. Merge your ready one and you’re out.');
   });
});
