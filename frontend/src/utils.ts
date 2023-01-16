import { DateString, CommitStatus } from './types';

export function actionMessage(action: string, date: DateString | null, user: string): string {
   return date ?
    `${action} on ${formatDate(date)} by ${user}` :
    `${action} by ${user}`;
}

export function formatDate(date: DateString) {
   return (new Date(date)).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
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

export function newTab(url: string) {
   window.open(url, "_blank");
}

export function useDurationMinutes(status: CommitStatus) {
   const {started_at, completed_at} = status.data;
   if (!started_at) {
      return null;
   }

   const completed = completed_at || Date.now() / 1000;
   const min = (completed - started_at)/60;
   return min > 0 ? min : null;
}
