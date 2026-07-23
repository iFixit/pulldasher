// @vitest-environment jsdom
//
// The rest of model/ is pure functions over plain data, so it runs fine in
// the default (node) vitest environment -- see vite.config.ts / package.json
// for why nothing else opts into jsdom. This module is a stateful store that
// touches sessionStorage, so it needs a real Storage implementation; the
// per-file `@vitest-environment` pragma above scopes that to just this file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Comfortably past the module's ~250ms debounce window.
const DEBOUNCE_WINDOW = 300;

function jsonResponse(body: unknown): Response {
   return { ok: true, json: async () => body } as Response;
}

async function importLive(fetchImpl: (url: string) => Promise<Response>) {
   vi.doMock('../backend/dummy', () => ({ isDummy: () => false }));
   const fetchMock = vi.fn(fetchImpl);
   vi.stubGlobal('fetch', fetchMock);
   const names = await import('./names');
   return { ...names, fetchMock };
}

describe('model/names', () => {
   beforeEach(() => {
      vi.resetModules();
      sessionStorage.clear();
      vi.useFakeTimers();
   });

   afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.doUnmock('../backend/dummy');
   });

   it('dedupes a login already known or already in flight', async () => {
      const { requestNames, getNames, fetchMock } = await importLive(async () =>
         jsonResponse({ names: { alice: 'Alice A' } })
      );

      requestNames(['alice']);
      requestNames(['alice']); // still pending in this window: no second entry
      await vi.advanceTimersByTimeAsync(DEBOUNCE_WINDOW);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getNames().alice).toBe('Alice A');

      requestNames(['alice']); // already resolved: must not refetch
      await vi.advanceTimersByTimeAsync(DEBOUNCE_WINDOW);
      expect(fetchMock).toHaveBeenCalledTimes(1);
   });

   it('batches logins requested within the debounce window into one fetch', async () => {
      const { requestNames, getNames, fetchMock } = await importLive(async () =>
         jsonResponse({ names: { alice: 'Alice A', bob: null } })
      );

      requestNames(['alice']);
      requestNames(['bob']);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_WINDOW);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain('alice');
      expect(url).toContain('bob');
      expect(getNames()).toEqual({ alice: 'Alice A', bob: null });
   });

   it('opens a new debounce window once the previous batch has flushed', async () => {
      const { requestNames, fetchMock } = await importLive(async () => jsonResponse({ names: {} }));

      requestNames(['alice']);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_WINDOW);
      requestNames(['bob']);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_WINDOW);

      expect(fetchMock).toHaveBeenCalledTimes(2);
   });

   it('leaves a login unresolved (retryable) after a failed fetch, rather than caching null', async () => {
      const { requestNames, getNames, fetchMock } = await importLive(async () => {
         throw new Error('network down');
      });

      requestNames(['alice']);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_WINDOW);
      expect(getNames()).toEqual({});

      // a later request retries rather than staying permanently unknown
      fetchMock.mockResolvedValue(jsonResponse({ names: { alice: 'Alice A' } }));
      requestNames(['alice']);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_WINDOW);
      expect(getNames().alice).toBe('Alice A');
   });

   it('round-trips the resolved map through sessionStorage across a reload', async () => {
      const first = await importLive(async () => jsonResponse({ names: { carol: 'Carol C' } }));
      first.requestNames(['carol']);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_WINDOW);
      expect(first.getNames().carol).toBe('Carol C');

      // Simulate a reload: a fresh module instance, same sessionStorage.
      vi.resetModules();
      vi.doMock('../backend/dummy', () => ({ isDummy: () => false }));
      const secondFetch = vi.fn();
      vi.stubGlobal('fetch', secondFetch);
      const second = await import('./names');

      expect(second.getNames().carol).toBe('Carol C');
      second.requestNames(['carol']);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_WINDOW);
      expect(secondFetch).not.toHaveBeenCalled();
   });

   it('treats a sessionStorage entry older than 24h as expired', async () => {
      sessionStorage.setItem(
         'pd2.names',
         JSON.stringify({ at: Date.now() - 25 * 3600_000, names: { carol: 'Carol C' } })
      );
      vi.doMock('../backend/dummy', () => ({ isDummy: () => false }));
      const { getNames } = await import('./names');
      expect(getNames()).toEqual({});
   });

   it('dummy mode resolves synchronously from a fixture, never touching the network', async () => {
      vi.doMock('../backend/dummy', () => ({ isDummy: () => true }));
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const { requestNames, getNames, displayName } = await import('./names');

      requestNames(['danielbeardsley', 'some-unknown-login']);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(getNames().danielbeardsley).toBe('Daniel Beardsley');
      expect(getNames()['some-unknown-login']).toBeNull();
      expect(displayName(getNames(), 'danielbeardsley')).toBe('Daniel Beardsley');
      expect(displayName(getNames(), 'some-unknown-login')).toBeNull();
   });
});

describe('displayName', () => {
   it('returns the name when known and non-empty, else null', async () => {
      vi.doMock('../backend/dummy', () => ({ isDummy: () => false }));
      const { displayName } = await import('./names');
      expect(displayName({}, 'nobody')).toBeNull();
      expect(displayName({ ghost: null }, 'ghost')).toBeNull();
      expect(displayName({ blank: '' }, 'blank')).toBeNull();
      expect(displayName({ alice: 'Alice A' }, 'alice')).toBe('Alice A');
   });
});
