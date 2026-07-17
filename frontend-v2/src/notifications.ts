import { useEffect, useRef } from 'react';
import { pullKey } from './format';
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

/**
 * A short synthesized chime — no audio asset to ship or path to couple to the
 * server layout, and CSP-safe. Best-effort: browsers block audio until the
 * user has interacted with the page, in which case the notification still
 * shows silently.
 */
function chime() {
   try {
      const Ctor =
         window.AudioContext ??
         (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      osc.onended = () => void ctx.close();
   } catch {
      // audio blocked: the desktop notification still fires, just silent
   }
}

interface Watch {
   key: string;
   match: (p: DerivedPull, me: string) => boolean;
   message: (titles: string[]) => string;
}

// The two transitions v1 alerted on, ported to v2's model.
const WATCHES: Watch[] = [
   {
      key: 'ready',
      match: (p, me) => p.data.user.login === me && p.status === 'ready',
      message: t =>
         t.length === 1 ? `Ready to merge: ${t[0]}` : `${t.length} of your PRs are ready to merge`,
   },
   {
      key: 'rereview',
      match: (p, me) => p.recrBy.includes(me) || p.reqaBy.includes(me),
      message: t =>
         t.length === 1 ? `Re-review owed: ${t[0]}` : `${t.length} re-reviews are waiting on you`,
   },
];

/**
 * Desktop notifications for your PRs becoming ready to merge and re-reviews
 * falling to you. Fires only for items that newly match since the last update,
 * so a steady board stays quiet — and the first payload after load only
 * primes the baseline, it never alerts for the backlog already sitting there.
 */
export function useNotifications(pulls: DerivedPull[], me: string) {
   const seen = useRef<Record<string, Set<string>>>({});
   const primed = useRef(false);

   useEffect(() => {
      const record = () => {
         for (const w of WATCHES)
            seen.current[w.key] = new Set(
               pulls.filter(p => w.match(p, me)).map(p => pullKey(p.data))
            );
      };

      const s = getSettings();
      const active =
         notificationsSupported && s.notify && Notification.permission === 'granted' && !!me;
      // keep the baseline current even while off, so toggling on doesn't flood
      if (!active || !primed.current) {
         record();
         primed.current = true;
         return;
      }

      for (const w of WATCHES) {
         const now = pulls.filter(p => w.match(p, me));
         const prev = seen.current[w.key] ?? new Set<string>();
         const fresh = now.filter(p => !prev.has(pullKey(p.data)));
         if (fresh.length) {
            try {
               new Notification(w.message(fresh.map(p => p.data.title)));
            } catch {
               // notification construction can throw on some platforms; ignore
            }
            if (s.notifySound) chime();
         }
         seen.current[w.key] = new Set(now.map(p => pullKey(p.data)));
      }
   }, [pulls, me]);
}
