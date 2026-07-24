import { useEffect, useRef, useState } from 'react';

/**
 * The arm-then-confirm state machine behind every destructive one-click-away
 * control on the board (delete a saved filter, delete a team, clear
 * settings): the first call to `arm` (or `run` while unarmed) arms for `ms`,
 * and only a `run` call inside that window actually fires — a single
 * misclick can't erase a hand-built list or a saved view. The disarm timer
 * lives in a ref so it survives re-renders and is always cleared on unmount,
 * even at call sites that never thought to do that themselves.
 */
export function useArmedConfirm(ms = 4000) {
   const [armed, setArmed] = useState(false);
   const disarm = useRef<ReturnType<typeof setTimeout> | null>(null);
   useEffect(
      () => () => {
         if (disarm.current) clearTimeout(disarm.current);
      },
      []
   );
   const arm = () => {
      setArmed(true);
      disarm.current = setTimeout(() => setArmed(false), ms);
   };
   const run = (fn: () => void) => {
      if (!armed) {
         arm();
         return;
      }
      if (disarm.current) clearTimeout(disarm.current);
      fn();
   };
   return { armed, arm, run };
}
