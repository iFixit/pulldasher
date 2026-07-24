import type { KeyboardEvent } from 'react';

/**
 * The "Enter commits, Escape cancels" keydown behind every inline text-entry
 * affordance on the board (renaming a team, adding a code region, naming a
 * new team or a saved view): Enter runs the commit and swallows the
 * keystroke so it never reaches an enclosing form; Escape — when the caller
 * has something sensible to revert to — does the same for backing out.
 * `onCancel` is optional: a field with no draft-vs-committed distinction of
 * its own just skips Escape entirely.
 */
export function commitKeyHandler({
   onCommit,
   onCancel,
}: {
   onCommit: () => void;
   onCancel?: () => void;
}) {
   return (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
         e.preventDefault();
         onCommit();
      } else if (e.key === 'Escape' && onCancel) {
         e.preventDefault();
         onCancel();
      }
   };
}
