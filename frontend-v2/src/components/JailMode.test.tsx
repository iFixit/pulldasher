// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { DerivedPull } from '../../../shared/model/status';
import { JailMode } from './JailMode';

// React's act() warns unless the environment says it's a test
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let n = 0;
const pull = (ageDays = 1) => {
   n += 1;
   return {
      data: {
         repo: 'iFixit/ifixit',
         number: n,
         title: `PR ${n}`,
         draft: false,
         state: 'open',
         user: { login: 'me' },
      },
      ageDays,
      deployBlockedBy: [],
   } as unknown as DerivedPull;
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
});
