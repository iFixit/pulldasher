import { DateString } from './types';

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

