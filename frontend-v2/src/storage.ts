import { useSyncExternalStore } from 'react';

/**
 * localStorage that never throws: privacy modes and blocked-storage settings
 * make every localStorage touch a potential SecurityError, and a preference
 * is never worth a white screen.
 */
export function readStorage(key: string): string | null {
   try {
      return localStorage.getItem(key);
   } catch {
      return null;
   }
}

export function writeStorage(key: string, value: string): void {
   try {
      localStorage.setItem(key, value);
   } catch {
      // storage blocked: the preference just doesn't persist
   }
}

export function removeStorage(key: string): void {
   try {
      localStorage.removeItem(key);
   } catch {
      // storage blocked: nothing was persisted to remove
   }
}

/**
 * Wipe every persisted preference — all of our `pd2.` localStorage keys
 * (settings, scope, last-seen marker). The caller reloads so the in-memory
 * stores re-initialize from their defaults.
 */
export function clearStoredPrefs(): void {
   try {
      for (const key of Object.keys(localStorage)) {
         if (key.startsWith('pd2.')) localStorage.removeItem(key);
      }
   } catch {
      // storage blocked: nothing was persisted to clear
   }
}

/**
 * A per-browser store for one JSON blob (settings, scope): load-with-defaults,
 * a listener set, and a useSyncExternalStore hook — the boilerplate settings
 * and scope each hand-rolled. Unknown fields in a stale saved blob fall back
 * to their default, so a new field never breaks an old blob.
 */
/**
 * createPersistentStore's in-memory twin: same get/set/subscribe/useValue
 * surface, nothing written anywhere. For state whose durable carrier is the
 * URL hash (scope) — a localStorage shadow copy of hash-carried state
 * resurrects stale versions of it on hash-less loads.
 */
export function createMemoryStore<T extends object>(defaults: T) {
   let value = { ...defaults };
   const listeners = new Set<() => void>();
   const subscribe = (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
   };
   return {
      get: () => value,
      set(next: T) {
         value = next;
         for (const fn of listeners) fn();
      },
      subscribe,
      useValue: () => useSyncExternalStore(subscribe, () => value),
   };
}

export function createPersistentStore<T extends object>(key: string, defaults: T) {
   const load = (): T => {
      try {
         return { ...defaults, ...(JSON.parse(readStorage(key) ?? '{}') as Partial<T>) };
      } catch {
         return { ...defaults };
      }
   };
   let value = load();
   const listeners = new Set<() => void>();
   const emit = () => {
      for (const fn of listeners) fn();
   };
   const subscribe = (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
   };
   return {
      get: () => value,
      set(next: T) {
         value = next;
         writeStorage(key, JSON.stringify(value));
         emit();
      },
      subscribe,
      useValue: () => useSyncExternalStore(subscribe, () => value),
   };
}
