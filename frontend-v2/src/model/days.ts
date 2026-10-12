/**
 * Local calendar days as YYYY-MM-DD, apart from model/projectData.ts so code
 * the review board loads (the URL's zoom check) can use them without pulling
 * in the Projects tab.
 */

/** A local Date's calendar day, YYYY-MM-DD. */
export function dayOf(date: Date): string {
   const m = String(date.getMonth() + 1).padStart(2, '0');
   const d = String(date.getDate()).padStart(2, '0');
   return `${date.getFullYear()}-${m}-${d}`;
}

/** A YYYY-MM-DD day as a local Date at midnight. */
export function dateOf(day: string): Date {
   const [y, m, d] = day.split('-').map(Number);
   return new Date(y, m - 1, d);
}
