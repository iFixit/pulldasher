import { pullKey } from '../../../shared/format';
import { SHIPPED_TOAST_KIND } from './cheers';
import type { Toast } from './toast';

/** Toast kinds that are ABOUT already-merged PRs, so a referenced pull missing
 * from the open board is the whole point, not staleness. The shipped catch-up
 * is the only one today; a new retrospective toast joins here. */
const RETROSPECTIVE_KINDS: ReadonlySet<string> = new Set([SHIPPED_TOAST_KIND]);

/** The pull keys a toast points you at: its single `pull`, its `pulls` batch,
 * or neither (a board-wide reward like inbox-zero). */
function toastPullKeys(toast: Toast): string[] {
   const refs = toast.pulls?.length ? toast.pulls : toast.pull ? [toast.pull] : [];
   return refs.map(pullKey);
}

/**
 * Whether a fired notification has gone stale: the PR it points you at has left
 * the open board (merged or closed), so whatever it asked you to do can't be
 * done anymore. The notification panel drops these, so a nudge like "return the
 * favor on fixbot#3116" removes itself the moment #3116 merges instead of
 * lingering as a dead link (prod report, Kyle 2026-07-27).
 *
 * Deliberately general -- every PR-linked kind, not just return-the-favor -- so
 * one rule governs the whole panel. Two shapes are never stale: a toast with no
 * PR (inbox-zero, board-cleared, a milestone count), since there's nothing to
 * resolve, and a retrospective recap (shipped), which lists merged PRs on
 * purpose. A toast pointing at several pulls is stale only once every one of
 * them is gone.
 *
 * `openKeys` is the set of pull keys currently on the OPEN board; a referenced
 * key that's absent has merged or closed. Feed it the FULL board rather than
 * the hidden-filtered subset, so a still-open PR you've merely hidden isn't
 * mistaken for done.
 */
export function notificationStale(toast: Toast, openKeys: ReadonlySet<string>): boolean {
   if (toast.kind && RETROSPECTIVE_KINDS.has(toast.kind)) return false;
   const keys = toastPullKeys(toast);
   if (keys.length === 0) return false;
   return keys.every(key => !openKeys.has(key));
}
