import { useEffect } from 'react';
import { modalOpen } from '../hooks';

/**
 * j and k move between a list's rows, the way they move between PRs on the
 * board: focus lands on each row's `target` (its answer, its name), and the
 * row scrolls clear of the sticky headers above it. A "+ N more" between two
 * rows (Truncated's, marked `data-row-more`) opens first, so j reaches every
 * row and not only the ones drawn. Rows hidden in a closed fold are
 * skipped. Typing in a field never moves.
 *
 * One rule for where it lands: the row's first `target` that can take the
 * focus. A target that's off (an answer waiting on its chooser) is passed
 * over for the row's first control that isn't a field (its name), since j
 * typed in a select would pick an option. A row with nowhere to land is
 * stepped past, so j and k reach every row from every row.
 *
 * It listens before the board's own j and k (useBoardHotkeys, which steps
 * between PR links) and claims the key, so a list's rows win wherever both
 * would answer: an opened Overview row shows board rows inside it.
 */
export function useRowKeys(row: string, target: string) {
   useEffect(() => {
      const focusRow = (el: HTMLElement) => {
         landingIn(el, target)?.focus({ preventScroll: true });
         // by hand: inside a rounded box (overflow hidden), scrollIntoView
         // drops the row's scroll margin, which is what keeps it below the
         // sticky headers
         const { top, bottom } = el.getBoundingClientRect();
         const under = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
         if (top < under) window.scrollBy(0, top - under);
         else if (bottom > window.innerHeight) window.scrollBy(0, bottom - window.innerHeight + 16);
      };
      const onKey = (e: KeyboardEvent) => {
         if ((e.key !== 'j' && e.key !== 'k') || e.metaKey || e.ctrlKey || e.altKey) return;
         // a modal dialog is open: rows behind it are out of reach
         if (modalOpen()) return;
         const t = e.target as HTMLElement;
         if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable) return;
         // drawn rows only: one in a closed fold has no box to land on
         const drawn = () =>
            [...document.querySelectorAll<HTMLElement>(row)].filter(r => r.getClientRects().length);
         const rows = drawn();
         if (!rows.length) return;
         const at = rows.findIndex(r => r.contains(document.activeElement));
         const step = e.key === 'j' ? 1 : -1;
         e.preventDefault();
         if (step > 0 && at !== -1) {
            // the rows after this one are folded away: a list's "+ N more"
            // comes right after its last drawn row, so open it, then go on
            const more = [...document.querySelectorAll<HTMLElement>('[data-row-more]')].find(m => {
               if (rows.some(r => r.contains(m))) return false;
               const before = rows.filter(
                  r => r.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING
               );
               return before.at(-1) === rows[at];
            });
            if (more) {
               more.click();
               requestAnimationFrame(() => {
                  const now = drawn();
                  const to = seek(now, now.indexOf(rows[at]), 1);
                  if (to) focusRow(to);
               });
               return;
            }
         }
         if (at === -1) {
            // from outside the rows (a section's header, a receipt): the
            // next row after where focus is, or the one before it for k
            const from = document.activeElement;
            const after = (r: HTMLElement) =>
               !!from &&
               from !== document.body &&
               !!(from.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING);
            // the first row after the focus for j, the last one before it for k
            const before = rows.filter(r => !after(r)).length;
            const first = step > 0 ? before : before - 1;
            const next = seek(rows, first - step, step) ?? seek(rows, step > 0 ? -1 : rows.length, step);
            if (next) focusRow(next);
            return;
         }
         // past the last row (or the first), it stays
         const next = seek(rows, at, step);
         if (next) focusRow(next);
      };
      /** the next row from `at` going `step` that has somewhere to land */
      const seek = (rows: HTMLElement[], at: number, step: number) => {
         for (let i = at + step; i >= 0 && i < rows.length; i += step)
            if (landingIn(rows[i], target)) return rows[i];
         return undefined;
      };
      // capture: ahead of the board's hotkeys, which stand down for a key
      // claimed here (hooks.ts checks defaultPrevented)
      document.addEventListener('keydown', onKey, true);
      return () => document.removeEventListener('keydown', onKey, true);
   }, [row, target]);
}

/** A control that isn't off (by `disabled` or `aria-disabled`) and is drawn. */
const pressable = (el: HTMLElement) =>
   !el.matches(':disabled, [aria-disabled="true"]') && el.getClientRects().length > 0;

/** The controls a row can land on when its target is off: never a field,
 * even one given a tabindex. */
const CONTROL =
   'button, a[href], [role="button"], [tabindex]:not([tabindex="-1"], input, select, textarea)';

/** Where j or k lands in a row: its first target that can take the focus,
 * else its first control that isn't a field, else nowhere. */
export function landingIn(row: HTMLElement, target: string): HTMLElement | undefined {
   return (
      [...row.querySelectorAll<HTMLElement>(target)].find(pressable) ??
      [...row.querySelectorAll<HTMLElement>(CONTROL)].find(pressable)
   );
}
