import apiController from './api.js';
import projectsController from './projects.js';
import roadmapController, { canWrite } from './roadmap.js';
import settingsController from './settings.js';
import { MAX_WEEKS, ROADMAP_HEALTHS, ROADMAP_STATUSES, WAITS_ON_MAX } from '../shared/dist/index.js';

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
      path: '/api/v1/roadmap',
      handlers: [roadmapController.list],
      does: 'Every roadmap item in priority order (top first), each with its latest update',
   },
   {
      method: 'post',
      path: '/api/v1/roadmap',
      handlers: [canWrite, roadmapController.create],
      does: 'Add an item at the bottom: {name, project?, team?, lead?, status?, start?, weeks?, notes?, waits_on?}',
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
      does: 'Replace the developer teams: {developer_teams}, or null to go back to config.js',
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
         start: 'YYYY-MM-DD; moved to its Monday',
         weeks: `a whole number, 1 to ${MAX_WEEKS}`,
         notes: 'up to 2000 characters',
         waits_on: `ids of other items this one waits on, at most ${WAITS_ON_MAX}, never a loop`,
      },
      update: {
         health: ROADMAP_HEALTHS,
         body: 'up to 2000 characters, may be empty',
      },
      settings: {
         developer_teams:
            'an object of team name to GitHub logins, {"Store": ["dana", "erin"]}; a login on one team at most',
      },
   });
}
