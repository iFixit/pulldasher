import { createPersistentStore } from '../storage';

// One-time, per-browser dismissal — a tip you've read once shouldn't nag again.
const dismissed = createPersistentStore<{ done: boolean }>('pd2.tip.codeRegions', {
   done: false,
});

/** Fire the event Settings listens for (see Settings.tsx), so the tip's
 * call-to-action opens the drawer where code regions are configured. */
export function openSettings(): void {
   window.dispatchEvent(new Event('pd2:open-settings'));
}

/**
 * How anyone discovers code regions without first digging through Settings: a
 * quiet, dismissible line shown on the board only while you have none set. It
 * says what the feature does and opens Settings to set it up. Dismissed for
 * good once you close it or add your first region (the caller only renders it
 * when codeRegions is empty).
 */
export function RegionHint() {
   const gone = dismissed.useValue().done;
   if (gone) return null;
   return (
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700 ring-1 ring-brand/15 ring-inset">
         <span aria-hidden className="text-brand">
            ◆
         </span>
         <span className="min-w-0 flex-1">
            Review a particular area? Add <b className="font-semibold">code regions</b> in Settings.
            A region is plain text matched against a PR’s title, labels, branch, and repo;
            matches gather in their own section above the queue.
         </span>
         <button
            type="button"
            onClick={openSettings}
            className="pressable flex-none rounded px-1.5 py-0.5 font-semibold text-brand hover:underline"
         >
            Set them up
         </button>
         <button
            type="button"
            aria-label="dismiss this tip"
            onClick={() => dismissed.set({ done: true })}
            className="hit pressable -m-0.5 flex-none rounded p-0.5 text-brand-700/70 hover:text-brand"
         >
            <svg
               viewBox="0 0 16 16"
               aria-hidden
               className="h-3.5 w-3.5"
               fill="none"
               stroke="currentColor"
               strokeWidth="1.75"
            >
               <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
         </button>
      </div>
   );
}
