import { DateString, PullData } from './types';

export function actionMessage(action: string, date: DateString | null, user: string): string {
   return date ?
    `${action} on ${formatDate(date)} by ${user}` :
    `${action} by ${user}`;
}

function formatDate(date: DateString) {
   return (new Date(date)).toLocaleDateString('en-us', {
      'month': 'short',
      'day': 'numeric'
   });
}

export function toDateString(date: Date): DateString {
   return date.toISOString();
}

export function userProfileUrl(username: string): string {
   const debottedName = username.replace(/\[bot\]$/, '');
   const safeUsername = encodeURIComponent(debottedName);
   return `https://github.com/${safeUsername}`;
}

export const dummyPulls: PullData[] = (process.env.DUMMY_PULLS || []) as PullData[];
export function hasDummyPulls() {
   return dummyPulls.length > 0;
}
