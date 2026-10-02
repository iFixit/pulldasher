import { type RefObject, useEffect, useLayoutEffect } from 'react';

/** A key press the board's keys leave alone: one a view's own keys
 * (components/useRowKeys.ts) already took, one typed into a field, or one
 * with a modifier, which belongs to the browser. */
function notOurs(e: KeyboardEvent): boolean {
   if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return true;
   const t = e.target as HTMLElement;
   return ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable;
}

/**
 * The keyboard model for an audience that lives in editors:
 *   /   jump to the filter box (v1's hotkey), or to a view's own find box
 *       where it has one (Projects' Overview, Roadmap and People mark theirs
 *       aria-keyshortcuts="/"), so the key never leaves the view
 *   j/k move focus down/up the rows (Enter opens — it's a link)
 *   c   copy the focused row's branch name
 */
export function useBoardHotkeys(searchRef: RefObject<HTMLInputElement | null>) {
   useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
         if (notOurs(e)) return;
         if (e.key === '/') {
            e.preventDefault();
            const box =
               document.querySelector<HTMLInputElement>('input[aria-keyshortcuts="/"]') ??
               searchRef.current;
            box?.focus();
            box?.select();
            return;
         }
         if (e.key === 'j' || e.key === 'k') {
            const links = [
               ...document.querySelectorAll<HTMLAnchorElement>('.pd-row a[href*="/pull/"]'),
            ];
            if (!links.length) return;
            const at = links.indexOf(document.activeElement as HTMLAnchorElement);
            const next =
               at === -1
                  ? e.key === 'j'
                     ? 0
                     : links.length - 1
                  : e.key === 'j'
                    ? Math.min(at + 1, links.length - 1)
                    : Math.max(at - 1, 0);
            links[next]?.focus();
            e.preventDefault();
            return;
         }
         if (e.key === 'c') {
            const row = (document.activeElement as HTMLElement | null)?.closest('.pd-row');
            const copy = row?.querySelector<HTMLButtonElement>('button[aria-label^="copy branch"]');
            copy?.click();
         }
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
   }, [searchRef]);
}

/**
 * A page's own key, as "a" adds an issue on a project's page: heard
 * anywhere on the page but in a field, never with a modifier. The control
 * it works carries it in aria-keyshortcuts, so a screen reader says so.
 */
export function usePageKey(key: string, run: () => void) {
   useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
         if (e.key !== key || notOurs(e)) return;
         e.preventDefault();
         run();
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
   }, [key, run]);
}

/**
 * Lane/section headers stick just below the app header; its height varies
 * (the toolbar wraps on narrow screens), so this publishes the measured
 * height as --header-h for their sticky offset. getBoundingClientRect, NOT
 * offsetHeight: the browser resolves sticky offsets against the header's
 * true fractional height, and offsetHeight's integer rounding leaves a
 * hairline gap above the stuck header at non-100% zoom, with scrolled rows
 * showing through it.
 */
export function useHeaderHeightVar(headerRef: RefObject<HTMLElement | null>) {
   useLayoutEffect(() => {
      const el = headerRef.current;
      if (!el) return;
      const publish = () =>
         document.documentElement.style.setProperty(
            '--header-h',
            `${el.getBoundingClientRect().height}px`
         );
      publish();
      const ro = new ResizeObserver(publish);
      ro.observe(el);
      return () => ro.disconnect();
   }, [headerRef]);
}
