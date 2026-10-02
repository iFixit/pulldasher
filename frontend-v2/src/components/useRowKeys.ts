import { useEffect } from 'react';

/**
 * j and k move between a list's rows, the way they move between PRs on the
 * board: focus lands on each row's `target` (its answer, its name), and the
 * row scrolls clear of the sticky headers above it. A "+ N more" between two
 * rows (Truncated's, marked `data-row-more`) opens first, so j reaches every
 * row and not only the ones drawn. Rows hidden in a closed fold are
 * skipped. Typing in a field never moves.
 *
 * It listens before the board's own j and k (useBoardHotkeys, which steps
 * between PR links) and claims the key, so a list's rows win wherever both
 * would answer: an opened Overview row shows board rows inside it.
 */
export function useRowKeys(row: string, target: string) {
   useEffect(() => {
      const focusRow = (el: HTMLElement) => {
         el.querySelector<HTMLElement>(target)?.focus({ preventScroll: true });
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
                  const from = now.indexOf(rows[at]);
                  const to = now[from + 1];
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
            const next =
               step > 0
                  ? rows.find(after) ?? rows[0]
                  : [...rows].reverse().find(r => !after(r)) ?? rows[rows.length - 1];
            focusRow(next);
            return;
         }
         focusRow(rows[Math.min(Math.max(at + step, 0), rows.length - 1)]);
      };
      // capture: ahead of the board's hotkeys, which stand down for a key
      // claimed here (hooks.ts checks defaultPrevented)
      document.addEventListener('keydown', onKey, true);
      return () => document.removeEventListener('keydown', onKey, true);
   }, [row, target]);
}
