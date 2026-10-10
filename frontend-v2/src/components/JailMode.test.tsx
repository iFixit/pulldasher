// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { derive, type DerivedPull } from '../../../shared/model/status';
import type { PullData } from '../../../shared/types';
import { setSettings } from '../settings';
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
   setSettings({ jailMode: 'auto' });
   vi.useRealTimers();
});

function render(pulls: DerivedPull[]) {
   const r = (root ??= createRoot(host));
   act(() => r.render(<JailMode pulls={pulls} me="me" extraBots={new Set()} initialized />));
}

const why = () => document.getElementById('jail-why')?.textContent;
const listed = () => document.querySelectorAll('[role="dialog"] li').length;
const dialog = () => document.querySelector('[role="dialog"]');
const countdown = () => document.querySelector('#jail-title span')?.textContent;
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

      expect(countdown()).toBe('2 to go');

      // merges bring you under the limits: it says so, then lets you go
      vi.useFakeTimers();
      render(first.slice(0, 3));
      expect(why()).toBe('You’re out. Nice work.');
      expect(countdown()).toBe('Free');
      expect(listed()).toBe(0);
      act(() => vi.advanceTimersByTime(2500));
      expect(dialog()).toBeNull();
   });

   it('lifts ready PRs to the top and counts them in the why line', () => {
      const ready = pull(2, { ready: true });
      render([...many(7), ready]);
      expect(headers()).toEqual(['Ready to merge', 'Waiting on others']);
      expect(document.querySelector('[role="dialog"] li a')?.textContent).toContain(
         ready.data.title
      );
      expect(why()).toBe('8 open PRs. Parole at 7. Merge your ready one and you’re out.');
   });

   it('only shows the badge when PR jail is manual', () => {
      setSettings({ jailMode: 'manual' });
      render(many(9));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      const badge = document.querySelector<HTMLButtonElement>('[aria-label^="PR jail"]');
      expect(badge).not.toBeNull();
      act(() => badge?.click());
      expect(why()).toMatch(/^9 open PRs/);
   });

   it('stays away, badge and all, when PR jail is off', () => {
      setSettings({ jailMode: 'off' });
      render(many(9));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.querySelector('[aria-label^="PR jail"]')).toBeNull();
   });

   it('lets you out only when the button is held down, by key or pointer', () => {
      vi.useFakeTimers();
      render(many(8));
      const snooze = [
         ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
      ].find(b => b.textContent?.includes('Hold to get back to work'));
      // it has focus from the start, so the keyboard can hold it right away
      expect(document.activeElement).toBe(snooze);
      const key = (type: string, k = 'Enter') =>
         act(() => snooze?.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true })));
      // a tap of Enter does nothing but say to hold it; neither does Esc
      key('keydown');
      act(() => vi.advanceTimersByTime(200));
      key('keyup');
      expect(snooze?.textContent).toBe('Hold it down');
      act(() => vi.advanceTimersByTime(3000));
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
      expect(dialog()).not.toBeNull();
      // holding Space the full two seconds turns the key, then it opens
      key('keydown', ' ');
      act(() => vi.advanceTimersByTime(2000));
      act(() => vi.advanceTimersByTime(700));
      expect(dialog()).toBeNull();
   });

   it('slides a merged PR out of the list as the countdown ticks', () => {
      vi.useFakeTimers();
      const nine = many(9);
      render(nine);
      expect(countdown()).toBe('2 to go');
      render(nine.slice(1));
      expect(countdown()).toBe('1 to go');
      // still there for the slide, then gone
      expect(document.querySelectorAll('.jail-row-leave')).toHaveLength(1);
      expect(listed()).toBe(9);
      act(() => vi.advanceTimersByTime(450));
      expect(listed()).toBe(8);
   });

   it('copies a nudge listing the PRs waiting on others', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText } });
      const first = pull(3);
      render([first, ...many(7)]);
      const copy = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
         b => b.textContent === 'Copy a nudge'
      );
      await act(async () => copy?.click());
      const text = (writeText.mock.calls[0] as unknown as [string])[0];
      expect(text.split('\n')).toHaveLength(9);
      expect(text).toContain(
         `• ${first.data.title} https://github.com/iFixit/ifixit/pull/${first.data.number}`
      );
      expect(copy?.textContent).toBe('Copied');
   });

   it('lets a screen reader or voice control out with a lone click', () => {
      render(many(8));
      const hold = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
         b => b.textContent?.includes('Hold to get back to work')
      );
      // a mouse click carries detail 1 and does nothing
      act(() => hold?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
      expect(dialog()).not.toBeNull();
      // assistive tech sends a click with no pointer or key behind it
      act(() => hold?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
      expect(dialog()).toBeNull();
   });

   it('keeps Esc from reaching anything behind it', () => {
      render(many(8));
      let reached = false;
      const behind = (e: KeyboardEvent) => {
         if (!e.defaultPrevented) reached = true;
      };
      document.addEventListener('keydown', behind);
      act(() => {
         document.body.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
         );
      });
      document.removeEventListener('keydown', behind);
      expect(reached).toBe(false);
      expect(dialog()).not.toBeNull();
   });

   it('forgets the last showing once you are under the limits', () => {
      vi.useFakeTimers();
      const nine = many(9);
      render(nine);
      expect(localStorage.getItem('pd2.jail')).not.toBeNull();
      render(nine.slice(0, 3));
      expect(localStorage.getItem('pd2.jail')).toBeNull();
   });

   it('opens the preview every time Settings asks', () => {
      render(many(2));
      expect(dialog()).toBeNull();
      act(() => window.dispatchEvent(new Event('pd2:preview-jail')));
      expect(dialog()).not.toBeNull();
   });

   it('a quick Space tap is not a lone click, even where the browser clicks on keyup', () => {
      render(many(8));
      const hold = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
         b => b.textContent?.includes('Hold to get back to work')
      );
      act(() => {
         hold?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
         hold?.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
         // Firefox's keyup click, with no pointer behind it
         hold?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
      });
      expect(dialog()).not.toBeNull();
   });

   it('keeps the last showing while it doesn’t know who you are', () => {
      localStorage.setItem('pd2.jail', JSON.stringify({ at: Date.now(), count: 9, over: [] }));
      const r = (root ??= createRoot(host));
      act(() => r.render(<JailMode pulls={many(9)} me="" extraBots={new Set()} initialized />));
      expect(localStorage.getItem('pd2.jail')).not.toBeNull();
      expect(dialog()).toBeNull();
   });
});
