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
