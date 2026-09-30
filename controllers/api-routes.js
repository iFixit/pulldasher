import apiController from './api.js';
import projectsController from './projects.js';
import roadmapController, { canWrite } from './roadmap.js';
import settingsController from './settings.js';
import {
   MAX_WEEKS,
   ROADMAP_HEALTHS,
   ROADMAP_ORIGINS,
   ROADMAP_STATUSES,
   DECIDE_MIN_PRS,
   STALL_DAYS,
   UPDATE_DUE_DAYS,
   WAITS_ON_MAX,
} from '../shared/dist/index.js';

/**
 * Every /api/v1 route in one table. app.js registers them from it, and
 * GET /api/v1 lists it, so a script (or an agent) reading the list can't
 * miss a route. Each takes the caller's own GitHub token as
 * `Authorization: Bearer <token>`; a write also needs a JSON body and is
 * recorded as that token's login.
 */
export const API_ROUTES = [
   {
      method: 'get',
      path: '/api/v1/me',
      handlers: [apiController.getMe],
      does: 'The GitHub login the token belongs to',
   },
   {
      method: 'get',
      path: '/api/v1/pulls',
      handlers: [apiController.getPulls],
      does: 'Every open PR with its review state, as the review board sees it',
   },
   {
      method: 'get',
      path: '/api/v1/projects',
      handlers: [projectsController.getProjects],
      does:
         'Every project: its issue fields, where it stands today, and its numbers for ?start=&end= ' +
         '(YYYY-MM-DD days, default the last 30); ?project=<slug> narrows the numbers to one',
   },
   {
      method: 'get',
      path: '/api/v1/people',
      handlers: [projectsController.getPeople],
      does: "Per person: team, the window's numbers, reviews given, live projects, open PRs; same ?start=&end=",
   },
   {
      method: 'get',
      path: '/api/v1/retro',
      handlers: [projectsController.getRetro],
      does:
         'Where the days went in ?start=&end= (default the last 30): per person and PR, their share of ' +
         'active days (a day they opened, merged, commented on, stamped or reviewed PRs, split across ' +
         'them), whether they wrote it, and its project',
   },
   {
      method: 'get',
      path: '/api/v1/updates-owed',
      handlers: [roadmapController.owed],
      does:
         'The leads who owe an update, each with the plans in progress they have not updated for ' +
         `${UPDATE_DUE_DAYS} days, longest overdue first: what a reminder would send each of them`,
   },
   {
      method: 'get',
      path: '/api/v1/decide',
      handlers: [projectsController.getDecide],
      does: 'The decisions owed now, worst first, each with its project, roadmap item, and reasons (see `decide`)',
   },
   {
      method: 'get',
      path: '/api/v1/load',
      handlers: [projectsController.getLoad],
      does:
         'Projects in flight each week against the developer count, on the roadmap (split by where the ' +
         'work came from) and not; weeks after this one as if nothing changes. ?start=&end= (default 12 ' +
         'weeks back to 26 ahead)',
   },
   {
      method: 'get',
      path: '/api/v1/roadmap',
      handlers: [roadmapController.list],
      does: 'Every roadmap item in priority order (top first), each with its latest update',
   },
   {
      method: 'post',
      path: '/api/v1/roadmap',
      handlers: [canWrite, roadmapController.create],
      does: 'Add an item at the bottom: {name, project?, team?, lead?, status?, origin?, start?, weeks?, notes?, waits_on?}',
   },
   {
      method: 'put',
      path: '/api/v1/roadmap/order',
      handlers: [canWrite, roadmapController.reorder],
      does: 'Set the whole order: {ids} naming every item once, top first; 409 with the current list if it changed',
   },
   {
      method: 'get',
      path: '/api/v1/roadmap/:id',
      handlers: [roadmapController.get],
      does: 'One item with its latest update',
   },
   {
      method: 'patch',
      path: '/api/v1/roadmap/:id',
      handlers: [canWrite, roadmapController.update],
      does: 'Change only the fields sent; null or "" clears an optional one',
   },
   {
      method: 'delete',
      path: '/api/v1/roadmap/:id',
      handlers: [canWrite, roadmapController.remove],
      does: 'Remove an item and its updates',
   },
   {
      method: 'post',
      path: '/api/v1/roadmap/:id/move',
      handlers: [canWrite, roadmapController.move],
      does: 'Move one item just above another: {before: <id>}, or {before: null} for the bottom',
   },
   {
      method: 'get',
      path: '/api/v1/roadmap/:id/updates',
      handlers: [roadmapController.updates],
      does: "An item's updates, newest first, each with the plan as it stood then",
   },
   {
      method: 'post',
      path: '/api/v1/roadmap/:id/updates',
      handlers: [canWrite, roadmapController.postUpdate],
      does: 'Post an update: {health, body?}',
   },
   {
      method: 'get',
      path: '/api/v1/settings',
      handlers: [settingsController.get],
      does: 'The settings people change, and whether each is saved or config.js’s',
   },
   {
      method: 'patch',
      path: '/api/v1/settings',
      handlers: [canWrite, settingsController.update],
      does:
         'Replace the developer teams, {developer_teams} (null goes back to config.js), or who ' +
         'takes turns running Decide, {decide_rotation: [logins]}, the first this week (null for nobody)',
   },
];

/** GET /api/v1 -- the route table and the rules a roadmap write is checked
 * against, so a caller can learn the API from the API. */
export function apiIndex(req, res) {
   res.json({
      auth: 'Authorization: Bearer <your GitHub token>, from a member of the org',
      endpoints: API_ROUTES.map(({ method, path, does }) => ({
         method: method.toUpperCase(),
         path,
         does,
      })),
      roadmap_item: {
         name: 'required on create, up to 120 characters',
         project: 'a project label slug to track its PRs, or null',
         team: 'a developer team name, or null',
         lead: 'a GitHub login, or null',
         status: ROADMAP_STATUSES,
         origin: {
            values: ROADMAP_ORIGINS,
            means:
               'where the work came from: asked for from above (top-down), or found by the team, ' +
               'as a fire to put out or its own pick (bottom-up); null until someone says',
         },
         start: 'YYYY-MM-DD; moved to its Monday',
         weeks: `a whole number, 1 to ${MAX_WEEKS}`,
         notes: 'up to 2000 characters',
         waits_on: `ids of other items this one waits on, at most ${WAITS_ON_MAX}, never a loop`,
      },
      update: {
         health: ROADMAP_HEALTHS,
         body: 'up to 2000 characters, may be empty',
      },
      decide: {
         reasons: {
            new: `in flight with ${DECIDE_MIN_PRS} or more PRs (open, or merged in the last 14 days) and never a roadmap item; since = its first open PR’s day`,
            stalled: `open PRs with no activity for ${STALL_DAYS} days or more, and no call since`,
            over: 'a plan under way ended `weeks` ago and its project still has PRs open',
            ended: 'a plan under way ended `weeks` ago with no PRs open: probably done',
            missed:
               'its target date `due` passed with `open` PRs open, and the plan hasn’t changed since',
            off_track: 'its latest update says off track, and the plan hasn’t changed since',
            at_risk: 'its latest update says at risk, and the plan hasn’t changed since',
            issue_closed:
               'its project issue was closed (`as` done or dropped, `on` a day) after the plan last changed, and the plan is still under way',
            reopened:
               'marked done or dropped a week ago or more (`by` the roadmap or by closing the issue), but `open` PRs are still open',
            moving: 'parked, but its PRs changed after it was parked',
         },
         to_clear:
            'Make the call as a roadmap write. With no item: POST /api/v1/roadmap {name, project, status, ' +
            'start, weeks}. With one: PATCH /api/v1/roadmap/:id with {status: "active", weeks} to commit, ' +
            '{status: "parked"}, {status: "done"}, or {status: "dropped"}. Any PATCH to an item counts as ' +
            `a decision, and quiets a stall for ${STALL_DAYS} days.`,
      },
      settings: {
         developer_teams:
            'an object of team name to GitHub logins, {"Store": ["dana", "erin"]}; a login on one team at most',
      },
   });
}
