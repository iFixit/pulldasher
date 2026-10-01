import { utcDay, type Project } from '../../../shared/model/projects';
import {
   addWeeks,
   mondayOf,
   type RoadmapItem,
   type RoadmapUpdate,
} from '../../../shared/model/roadmap';
import type { AttachedIssue, IssueHit, IssueRef } from '../../../shared/model/work';
import { SCALE_TEAM_ADDS, scaleCount, scaleProjects } from './dummyScale';

// The dummy board's projects, teams and roadmap: what /projects-data and
// /roadmap would send. They live apart from backend/dummy.ts, which the
// review board loads, so only the lazy Projects tab carries them.

const inDays = (days: number) => new Date(Date.now() + days * 86400_000).toISOString();

/** Developer teams, as the server's config.js `projects.developerTeams` sends
 * them. Everyone else in the fixture shows as a non-developer, so the People
 * view and the developer split on every project demo both kinds. */
const BASE_TEAMS: Record<string, string[]> = {
   Store: ['danielbeardsley', 'jarstelfox', 'sctice', 'zdmitchell'],
   FixBot: ['mlahargou', 'ardelato'],
   Community: ['rjmccluskey', 'sivadnor', 'hackalot805', 'djmetzle'],
};
// a board scaled with ?projects= has a real-sized team too (dummyScale.ts)
const SCALE = scaleCount();
export const DUMMY_TEAMS: Record<string, string[]> = SCALE
   ? Object.fromEntries(
        Object.entries(BASE_TEAMS).map(([team, logins]) => [
           team,
           [...logins, ...(SCALE_TEAM_ADDS[team] ?? [])],
        ])
     )
   : BASE_TEAMS;
const SCALED = scaleProjects(SCALE);
const dummyProject = (
   number: number,
   slug: string,
   name: string,
   over: Partial<Project> = {}
): Project => ({
   slug,
   name,
   repo: 'iFixit/projects',
   number,
   state: 'open',
   state_reason: null,
   ongoing: false,
   parents: [],
   lead: null,
   target: null,
   fields: { start: null, target: null, priority: null },
   created_at: inDays(-60 + number * 3),
   closed_at: over.state === 'closed' ? inDays(-number) : null,
   ...over,
});

/** The project issues behind the dummy labels, as /projects-data sends them.
 * translations and onboarding-emails have no PRs (they land in quiet), and
 * old-checkout was dropped, so Today never shows it. */
const BASE_PROJECTS: Project[] = [
   dummyProject(1, 'webdriver-deflake', 'Deflake the webdriver tests', {
      ongoing: true,
      lead: 'mlahargou',
      parents: ['ci'],
   }),
   dummyProject(2, 'grafana-dashboards', 'Grafana dashboards for content', { lead: 'sivadnor' }),
   dummyProject(3, 'training-periods', 'Training periods', {
      lead: 'hackalot805',
      target: { title: 'October', due_on: inDays(30) },
   }),
   dummyProject(4, 'release-gate-sso', 'SSO approvals for releases', {
      parents: ['security'],
      lead: 'rjmccluskey',
      target: { title: 'Security review', due_on: inDays(-5) },
   }),
   // dated the way GitHub's issue fields date an issue, with no milestone
   dummyProject(5, 'shopify-sync', 'Shopify product and order sync', {
      lead: 'zdmitchell',
      parents: ['store'],
      fields: {
         start: inDays(-40).slice(0, 10),
         target: inDays(20).slice(0, 10),
         priority: 'high',
      },
   }),
   dummyProject(6, 'shipping-shelf-weight', 'Ship by shelf weight', {
      parents: ['store', 'warehouse'],
   }),
   dummyProject(7, 'mysql-8', 'MySQL 8 upgrade', {
      lead: 'evannoronha',
      target: { title: 'Q4 infrastructure', due_on: inDays(75) },
   }),
   dummyProject(8, 'akeneo-4', 'Akeneo 4 migration', {
      state: 'closed',
      state_reason: 'completed',
   }),
   dummyProject(9, 'newsletter-promo', 'Newsletter promo page'),
   dummyProject(10, 'store-picker', 'Store picker', { parents: ['store'] }),
   dummyProject(11, 'type-refresh', 'Type and spacing refresh', { lead: 'danielbeardsley' }),
   dummyProject(12, 'translations', 'Translations upkeep', { ongoing: true }),
   dummyProject(13, 'onboarding-emails', 'Onboarding emails'),
   // the SSO plan ships its first path alone; the second is a phase of its own
   dummyProject(15, 'release-gate-sso-second-path', 'SSO approvals: the second path', {
      lead: 'rjmccluskey',
      parents: ['release-gate-sso'],
   }),
   dummyProject(14, 'old-checkout', 'Old checkout cleanup', {
      state: 'closed',
      state_reason: 'not_planned',
   }),
];

export const DUMMY_PROJECTS: Project[] = [
   ...BASE_PROJECTS,
   ...SCALED.map((p, k) =>
      dummyProject(100 + k, p.slug, p.name, { lead: p.lead, created_at: inDays(-p.startDaysAgo) })
   ),
];

/**
 * The roadmap a project manager might have laid out, relative to this week:
 * linked items whose PRs draw over the plan (SSO approvals ran past its
 * plan, Akeneo 4 is done), plans with no PRs yet (Checkout redesign, Search
 * relevance), and several live projects left off it, so the "not on the
 * roadmap" list demos too. The updates show every standing: SSO approvals
 * slid from on track to off track as its plan grew, the webdriver work's
 * last update is overdue, MySQL 8 never had one, and Checkout redesign is
 * flagged at risk before it starts.
 */
export const { DUMMY_ROADMAP, DUMMY_ROADMAP_UPDATES } = (() => {
   const monday = mondayOf(utcDay(Date.now() / 1000));
   const at = (weeks: number) => addWeeks(monday, weeks);
   const now = Math.floor(Date.now() / 1000);
   let nextUpdate = 1;
   const update = (
      itemId: number,
      daysAgo: number,
      health: RoadmapUpdate['health'],
      author: string,
      plan: [number, number],
      body: string
   ): RoadmapUpdate => ({
      id: nextUpdate++,
      item_id: itemId,
      health,
      body,
      plan_start: at(plan[0]),
      plan_weeks: plan[1],
      author,
      at: now - daysAgo * 86400 - 3600,
   });
   // oldest first, the way they were posted
   const updates = [
      update(8, 60, 'on_track', 'zdmitchell', [-11, 8], 'Catalog import works end to end.'),
      update(
         1,
         30,
         'on_track',
         'rjmccluskey',
         [-8, 4],
         'Design approved; building the approval step.'
      ),
      update(3, 24, 'on_track', 'mlahargou', [-6, 12], 'Down to four flaky tests.'),
      update(
         1,
         16,
         'at_risk',
         'rjmccluskey',
         [-8, 5],
         'Security review found two gaps in the approval step. Fixing them first.'
      ),
      update(2, 5, 'on_track', 'zdmitchell', [-4, 7], 'Orders sync in staging; products are next.'),
      update(
         1,
         3,
         'off_track',
         'rjmccluskey',
         [-8, 6],
         'The audit moved up a week, and the second approval path won’t make it.\nAsking to ship the first path alone.'
      ),
      update(
         4,
         2,
         'at_risk',
         'jarstelfox',
         [3, 8],
         'Waiting on the design review; the start may slip.'
      ),
   ];
   const item = (
      id: number,
      name: string,
      start: number,
      weeks: number,
      over: Partial<RoadmapItem>
   ): RoadmapItem => ({
      id,
      name,
      project: null,
      team: null,
      lead: null,
      status: 'planned',
      origin: null,
      start: at(start),
      weeks,
      priority: id - 1,
      notes: '',
      waits_on: [],
      updated_by: 'danielbeardsley',
      updated_at: Math.floor(Date.now() / 1000) - id * 3600,
      // made when they started, as far as updates go
      created_at: null,
      update: updates.filter(u => u.item_id === id).at(-1) ?? null,
      ...over,
   });
   const items = [
      item(1, 'SSO approvals for releases', -8, 6, {
         project: 'release-gate-sso',
         team: 'Community',
         lead: 'rjmccluskey',
         status: 'active',
         notes: 'Security asked for this before the audit.',
      }),
      item(2, 'Shopify product and order sync', -4, 8, {
         project: 'shopify-sync',
         team: 'Store',
         lead: 'zdmitchell',
         status: 'active',
         // last touched before its last issue closed, so Decide asks "Done?"
         updated_at: Math.floor(Date.now() / 1000) - 10 * 86400,
      }),
      item(3, 'Deflake the webdriver tests', -6, 12, {
         project: 'webdriver-deflake',
         team: 'FixBot',
         lead: 'mlahargou',
         status: 'active',
      }),
      item(4, 'Checkout redesign', 3, 8, { team: 'Store', lead: 'jarstelfox', waits_on: [2] }),
      item(5, 'MySQL 8 upgrade', -2, 12, {
         project: 'mysql-8',
         team: 'Community',
         lead: 'evannoronha',
         status: 'active',
      }),
      item(6, 'Search relevance', 7, 6, { team: 'FixBot', waits_on: [3] }),
      item(7, 'Translations upkeep', -1, 26, { project: 'translations', team: 'Community' }),
      item(8, 'Akeneo 4 migration', -11, 8, {
         project: 'akeneo-4',
         team: 'Store',
         status: 'done',
      }),
      // FixBot's two developers would each be alone on a plan while this
      // overlaps the webdriver work, so its lane's load shows amber
      item(9, 'Visual regression checks', 1, 6, { team: 'FixBot', lead: 'ardelato' }),
   ];
   // about one in eight scaled projects is planned: active since its first
   // PR, in the lane of its lead's team
   const teamOf = (login: string) =>
      Object.keys(DUMMY_TEAMS).find(team => DUMMY_TEAMS[team].includes(login)) ?? null;
   SCALED.forEach((p, k) => {
      if (!p.planned) return;
      const id = 100 + k;
      items.push(
         item(id, p.name, -Math.round(p.startDaysAgo / 7), 4 + (k % 9), {
            project: p.slug,
            team: teamOf(p.lead),
            lead: p.lead,
            status: 'active',
         })
      );
   });
   return { DUMMY_ROADMAP: items, DUMMY_ROADMAP_UPDATES: updates };
})();

/**
 * The dummy board's issues attached to projects, by slug (model/workData.ts):
 * SSO approvals has work left, Shopify sync has every issue closed (so
 * Decide asks "Done?"), the webdriver work is midway, and Akeneo is done.
 * One webdriver issue was added to SSO approvals by hand too, so both pages
 * say it's in the other.
 */
export const DUMMY_ATTACHED: Record<string, AttachedIssue[]> = (() => {
   const day = 86400;
   const now = Math.floor(Date.now() / 1000);
   const issue = (
      number: number,
      title: string,
      state: AttachedIssue['state'],
      daysAgo: { joined?: number; closed?: number } = {}
   ): AttachedIssue => ({
      ref: { repo: 'iFixit/ifixit', number },
      title,
      state,
      closedAt: daysAgo.closed == null ? null : now - daysAgo.closed * day,
      // opened a couple of days before it joined the project
      author: number % 2 ? 'danielbeardsley' : 'zdmitchell',
      createdAt: now - ((daysAgo.joined ?? 30) + 2) * day,
      via: ['label'],
      attachedAt: daysAgo.joined == null ? null : now - daysAgo.joined * day,
      addedBy: null,
   });
   // its flaky tests hold up the release gates
   const gateTests = issue(35806, 'Deflake the release-gate approval tests', 'open', {
      joined: 9,
   });
   return {
      'release-gate-sso': [
         issue(35001, 'Require a second approver on release gates', 'done', {
            joined: 60,
            closed: 40,
         }),
         issue(35002, 'Make the release-gate signoffs user editable', 'done', {
            joined: 60,
            closed: 20,
         }),
         issue(35003, 'Audit log for approvals', 'done', { joined: 58, closed: 15 }),
         issue(35004, 'Flip the default for the second approval path', 'open', { joined: 30 }),
         issue(35005, 'Email approvers when a gate waits', 'dropped', { joined: 50, closed: 25 }),
         { ...gateTests, via: ['hand'], attachedAt: now - 5 * day, addedBy: 'rjmccluskey' },
      ],
      'shopify-sync': [
         issue(35401, 'Sync products nightly', 'done', { joined: 28, closed: 12 }),
         issue(35402, 'Sync orders as they land', 'done', { joined: 28, closed: 6 }),
         issue(35403, 'Backfill a year of orders', 'done', { joined: 20, closed: 3 }),
         issue(35404, 'Alert on sync drift', 'dropped', { joined: 20, closed: 4 }),
      ],
      'webdriver-deflake': [
         issue(35801, 'Retry the network-bound steps once', 'done', { joined: 42, closed: 30 }),
         issue(35802, 'Quarantine the five flakiest tests', 'done', { joined: 42, closed: 21 }),
         issue(35803, 'Run IE11 tests in parallel', 'open', { joined: 42 }),
         issue(35804, 'Record a video on failure', 'open', { joined: 10 }),
         issue(35805, 'Seed the test store once per run', 'open', { joined: 8 }),
         gateTests,
      ],
      'akeneo-4': [
         issue(36201, 'Upgrade the connector', 'done', { joined: 77, closed: 50 }),
         issue(36202, 'Move the attribute mapping', 'done', { joined: 77, closed: 45 }),
      ],
   };
})();

/** Which dummy PRs link which issues, by "owner/repo#number" of the PR:
 * the "Parts of #N" a real board reads off a PR's body and off each
 * issue's cross-references. Two link issues no one attached yet, so their
 * projects' pages suggest them. */
export const DUMMY_LINKS: Record<string, IssueRef[]> = {
   'iFixit/ifixit#35059': [{ repo: 'iFixit/ifixit', number: 35002 }],
   'iFixit/ifixit#35103': [
      { repo: 'iFixit/ifixit', number: 35004 },
      { repo: 'iFixit/ifixit', number: 35021 },
   ],
   'iFixit/ifixit#351011': [{ repo: 'iFixit/ifixit', number: 35004 }],
   'iFixit/ifixit#33495': [
      { repo: 'iFixit/ifixit', number: 35803 },
      { repo: 'iFixit/ops', number: 812 },
   ],
   'iFixit/ifixit#35154': [{ repo: 'iFixit/ifixit', number: 35802 }],
   // no project label: it joins webdriver-deflake by linking its issue
   'iFixit/ifixit#35501': [{ repo: 'iFixit/ifixit', number: 35805 }],
};

/** Issues the dummy board's issue search finds that no project has, for
 * adding one by hand (model/projectWork.ts). */
export const DUMMY_ISSUES: IssueHit[] = (() => {
   const day = 86400;
   const now = Math.floor(Date.now() / 1000);
   const hit = (
      repo: string,
      number: number,
      title: string,
      state: IssueHit['state'],
      author: string,
      daysAgo: number
   ): IssueHit => ({ repo, number, title, state, author, createdAt: now - daysAgo * day });
   return [
      hit('iFixit/ifixit', 35021, 'SSO: let a lead approve from Slack', 'open', 'rjmccluskey', 6),
      hit(
         'iFixit/ifixit',
         35410,
         'Shopify: retry an order sync that failed',
         'open',
         'zdmitchell',
         3
      ),
      hit(
         'iFixit/ifixit',
         35411,
         'Shopify: log sync drift per store',
         'open',
         'danielbeardsley',
         9
      ),
      hit(
         'iFixit/ifixit',
         35020,
         'SSO: show who approved a release gate',
         'done',
         'rjmccluskey',
         40
      ),
      hit('iFixit/ops', 812, 'Webdriver: keep failure videos for a week', 'open', 'mlahargou', 12),
      hit(
         'iFixit/ifixit',
         36210,
         'Akeneo: drop the old attribute sync job',
         'dropped',
         'danielbeardsley',
         70
      ),
      hit(
         'iFixit/ifixit',
         35415,
         'Translations: flag strings nobody has reviewed',
         'open',
         'sctice',
         5
      ),
   ];
})();
