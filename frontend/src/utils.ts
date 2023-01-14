import { DateString, PullData, StatusState } from './types';

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

export const dummyPulls: PullData[] = fakeCIStatuses((process.env.DUMMY_PULLS || []) as PullData[]);
export function hasDummyPulls() {
   return dummyPulls.length > 0;
}

export function newTab(url: string) {
   window.open(url, "_blank");
}

function fakeCIStatuses(pulls: PullData[]) {
   const fakeContexts = ['psalm', 'deploy', 'unit-tests', 'api', 'integration', 'browser', 'bundle-analysis'];
   pulls.forEach((pull) => {
      pull.status.commit_statuses = fakeContexts.map((context) => {
         const now = unix();
         const startedAt = now - (Math.random() * 120 * 60);
         const duration = Math.random() * 10 * 60;
         const completedAt = startedAt + duration;
         return {data: {
            sha: "fake sha",
            target_url: "https://example.com",
            description: context,
            context: context,
            state: completedAt > now ? StatusState.pending : finishedState(),
            started_at: startedAt,
            completed_at: completedAt > now ? null : completedAt,
         }};
      });
   });
   return pulls;
}

function finishedState() {
   const r = Math.random();
   return r < 0.01 ? StatusState.error :
      (r < 0.03 ? StatusState.failure : StatusState.success);
}

function unix() {
   return Date.now() / 1000;
}
