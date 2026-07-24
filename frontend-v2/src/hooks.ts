import { type RefObject, useEffect, useLayoutEffect } from 'react';

/**
 * The keyboard model for an audience that lives in editors:
 *   /   jump to the filter box (v1's hotkey)
 *   j/k move focus down/up the rows (Enter opens — it's a link)
 *   c   copy the focused row's branch name
 */
export function useBoardHotkeys(searchRef: RefObject<HTMLInputElement | null>) {
   useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
         if (e.metaKey || e.ctrlKey || e.altKey) return;
         const t = e.target as HTMLElement;
         if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable) return;
         if (e.key === '/') {
            e.preventDefault();
            searchRef.current?.focus();
            searchRef.current?.select();
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
