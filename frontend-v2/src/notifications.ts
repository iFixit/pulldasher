import { useEffect, useRef } from 'react';
import { githubUrl, pullKey, shortRepo } from './format';
import { alertMove } from './model/actions';
import type { DerivedPull } from './model/status';
import { getSettings } from './settings';

export const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window;

export function notifyPermission(): NotificationPermission {
   return notificationsSupported ? Notification.permission : 'denied';
}

export async function requestNotifyPermission(): Promise<NotificationPermission> {
   if (!notificationsSupported) return 'denied';
   return Notification.requestPermission();
}

// ── Sound ──────────────────────────────────────────────────────────────────
// Autoplay policy blocks audio until the page has had a user gesture, and a
// notification fires when the tab is in the background — exactly when a
// fresh, never-unlocked AudioContext would be muted. So keep one context,
// unlocked by the Settings toggle's click (a gesture), and reuse it.
let audioCtx: AudioContext | null = null;
function ctor(): typeof AudioContext | undefined {
   return (
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
   );
}

/** Call from a user gesture (the Sound toggle) so later chimes aren't muted. */
export function unlockSound() {
   try {
      const C = ctor();
      if (!C) return;
      audioCtx ??= new C();
      void audioCtx.resume();
   } catch {
      // audio unavailable: notifications still fire silently
   }
}

function chime() {
   try {
      const C = ctor();
      if (!C) return;
      audioCtx ??= new C();
      const ctx = audioCtx;
      void ctx.resume();
      const t0 = ctx.currentTime;
      const note = (freq: number, start: number, dur: number) => {
         const osc = ctx.createOscillator();
         const gain = ctx.createGain();
         osc.type = 'sine';
         osc.frequency.value = freq;
         gain.gain.setValueAtTime(0.0001, t0 + start);
         gain.gain.exponentialRampToValueAtTime(0.18, t0 + start + 0.01);
         gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
         osc.connect(gain).connect(ctx.destination);
         osc.start(t0 + start);
         osc.stop(t0 + start + dur);
      };
      note(660, 0, 0.18);
      note(990, 0.13, 0.26);
   } catch {
      // best-effort: a blocked chime never blocks the notification
   }
}

// ── Notifications ────────────────────────────────────────────────────────────
// Friendlier titles than the terse in-board verbs.
const TITLE: Record<string, string> = {
   'Merge it': 'Ready to merge',
   'Fix CI': 'CI failed',
   'Address feedback': 'Changes requested',
   Rebase: 'Needs a rebase',
   'Re-stamp': 'Re-review owed',
   'Re-QA': 'Re-QA owed',
};

function fire(p: DerivedPull, action: string) {
   try {
      const notification = new Notification(TITLE[action] ?? action, {
         body: `${p.data.title} · ${shortRepo(p.data.repo)} #${p.data.number}`,
         // one live notification per PR: a newer state replaces the old one
         tag: pullKey(p.data),
      });
      notification.onclick = () => {
         window.focus();
         window.open(githubUrl(p.data.repo, p.data.number), '_blank', 'noopener');
         notification.close();
      };
   } catch {
      // construction can throw on some platforms; a failed alert is not fatal
   }
}

/** Fire a sample notification so the user can confirm the setup works. */
export function testNotification() {
   if (!notificationsSupported || Notification.permission !== 'granted') return;
   try {
      const notification = new Notification('Pulldasher notifications are on', {
         body: 'You’ll get a nudge here when a PR needs you.',
      });
      notification.onclick = () => {
         window.focus();
         notification.close();
      };
   } catch {
      // ignore
   }
   if (getSettings().notifySound) chime();
}

/** At most this many individual alerts per update; a rare bigger burst collapses. */
const MAX_PER_TICK = 5;

/**
 * Desktop notifications for every real transition that lands on you — your PR
 * going mergeable, breaking CI, getting feedback or needing a rebase, and
 * re-CRs / re-QAs falling to you (model/actions alertMove). Watches the whole
 * board, not the current filter.
 *
 * Only fires while the window is unfocused: when you're looking, the board
 * already surfaces the change, so a desktop alert would just be noise. The
 * baseline is recorded on every update regardless, so returning to the tab and
 * leaving again never replays what already happened, and the first payload
 * after load only primes the baseline instead of alerting for the backlog.
 */
export function useNotifications(pulls: DerivedPull[], me: string) {
   // pull key → the action last seen for it, so a changed action re-alerts
   const seen = useRef<Map<string, string>>(new Map());
   const primed = useRef(false);

   useEffect(() => {
      const current = new Map<string, string>();
      for (const p of pulls) {
         const action = alertMove(p, me);
         if (action) current.set(pullKey(p.data), action);
      }

      const s = getSettings();
      const active =
         notificationsSupported && s.notify && Notification.permission === 'granted' && !!me;

      // record the baseline but stay silent while off, unprimed, or focused
      if (!active || !primed.current || document.hasFocus()) {
         seen.current = current;
         primed.current = true;
         return;
      }

      const byKey = new Map(pulls.map(p => [pullKey(p.data), p]));
      let fired = 0;
      for (const [key, action] of current) {
         if (seen.current.get(key) === action) continue; // unchanged
         const p = byKey.get(key);
         if (p && fired < MAX_PER_TICK) {
            fire(p, action);
            fired++;
         }
      }
      if (fired > 0 && s.notifySound) chime();
      seen.current = current;
   }, [pulls, me]);
}
