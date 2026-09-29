import pullManager from '../lib/pull-manager.js';
import { respondOrError } from '../lib/controller-utils.js';
import {
   loadProjects,
   loadSpans,
   parseWindow,
   projectSettings,
   todayFromBoard,
} from '../lib/projects.js';
import { windowStats, MISC_SLUG } from '../shared/dist/index.js';

const key = d => `${d.repo}#${d.number}`;

/**
 * Validate the projects config and the requested window, then load the
 * projects and the window's PR history. Answers the request itself (404 when
 * projects aren't set up here, 400 for a bad window) and returns null, or
 * returns a promise of what the handler needs.
 */
function load(req, res) {
   const settings = projectSettings();
   if (!settings) {
      res.status(404).json({ error: 'projects are not set up on this Pulldasher' });
      return null;
   }
   const window = parseWindow(req.query);
   if (window.error) {
      res.status(400).json({ error: window.error });
      return null;
   }
   return Promise.all([
      loadProjects(settings),
      loadSpans(settings, window.start, window.end),
   ]).then(([projects, spans]) => ({
      settings,
      projects,
      stats: windowStats(spans, window.start, window.end),
   }));
}

/**
 * One record per project for the API: what its issue says, where it stands
 * today, and its numbers for the window. Live projects first in Today's order,
 * then quiet ones, then the rest (done, dropped, or only in the window's
 * history) by slug.
 */
function projectRecords(projects, today, stats, prefix) {
   const bySlug = new Map(projects.map(p => [p.slug, p]));
   const groups = new Map();
   const standing = new Map();
   for (const [list, word] of [
      [today.live, 'live'],
      [today.quiet, 'quiet'],
   ]) {
      for (const g of list) {
         groups.set(g.slug, g);
         standing.set(g.slug, word);
      }
   }
   const rest = [...new Set([...bySlug.keys(), ...Object.keys(stats.projects)])]
      .filter(slug => slug !== MISC_SLUG && !groups.has(slug))
      .sort();
   return [...groups.keys(), ...rest].map(slug => {
      const p = bySlug.get(slug) || null;
      const g = groups.get(slug) || null;
      const closedAs =
         p && p.state === 'closed' ? (p.state_reason === 'not_planned' ? 'dropped' : 'done') : null;
      return {
         slug,
         name: p ? p.name : slug,
         label: prefix + slug,
         issue: p
            ? {
                 repo: p.repo,
                 number: p.number,
                 url: `https://github.com/${p.repo}/issues/${p.number}`,
                 state: p.state,
                 state_reason: p.state_reason,
              }
            : null,
         ongoing: p ? p.ongoing : false,
         parents: p ? p.parents : [],
         lead: p ? p.lead : null,
         target: p ? p.target : null,
         // live and quiet come from Today; a closed issue with no open PR is
         // done or dropped; a slug seen only in the window's history is null
         standing: standing.get(slug) || closedAs,
         open: g ? g.open.map(d => key(d.data)) : [],
         merged_recently: g ? g.merged.map(key) : [],
         people: g ? g.people : [],
         idle_days: g ? g.idleDays : null,
         flags: g ? g.flags : [],
         window: stats.projects[slug] || null,
      };
   });
}

export default {
   /**
    * GET /projects-data?start=&end= -- the Projects tab's fetch: every project
    * issue plus the window's numbers. The tab builds Today itself from the live
    * socket pulls, so it moves with the board. Session-authed like
    * /stats-history.
    */
   getBoardData: function (req, res) {
      const loaded = load(req, res);
      if (!loaded) return;
      respondOrError(
         res,
         loaded.then(({ settings, projects, stats }) => ({
            label_prefix: settings.prefix,
            projects_repo: settings.repo,
            projects,
            window: stats,
         })),
         'projects-data query failed'
      );
   },

   /**
    * GET /api/v1/projects?start=&end= -- every project with its issue fields,
    * where it stands today (open PR ids, people, idle days, flags), and its
    * numbers for the window (default: the last 30 days), plus the totals and
    * one point per day for the backlog chart. Bearer-authed (lib/api-auth).
    * Dates are YYYY-MM-DD UTC days, both counted.
    */
   getProjects: function (req, res) {
      const loaded = load(req, res);
      if (!loaded) return;
      respondOrError(
         res,
         loaded.then(({ settings, projects, stats }) => {
            const now = Date.now() / 1000;
            const today = todayFromBoard(pullManager.getPulls(), projects, settings.prefix, now);
            return {
               server_time: Math.floor(now),
               start: stats.start,
               end: stats.end,
               label_prefix: settings.prefix,
               projects: projectRecords(projects, today, stats, settings.prefix),
               misc: {
                  open: today.misc.map(d => key(d.data)),
                  window: stats.projects[MISC_SLUG] || null,
               },
               unsorted: { open: today.unsorted.map(d => key(d.data)), window: stats.unsorted },
               double_labeled: today.doubleLabeled.map(d => key(d.data)),
               totals: stats.totals,
               days: stats.days,
            };
         }),
         'projects query failed'
      );
   },

   /**
    * GET /api/v1/people?start=&end= -- per person: the window's numbers, the
    * projects they had PRs in during it, the live projects they're on today,
    * and how many PRs they have open now. Most live projects first, which is
    * how a reader spots someone spread thin. Bots are left out.
    */
   getPeople: function (req, res) {
      const loaded = load(req, res);
      if (!loaded) return;
      respondOrError(
         res,
         loaded.then(({ settings, projects, stats }) => {
            const now = Date.now() / 1000;
            const today = todayFromBoard(pullManager.getPulls(), projects, settings.prefix, now);
            const live = new Map();
            for (const g of today.live) {
               for (const login of g.people) {
                  if (!live.has(login)) live.set(login, []);
                  live.get(login).push(g.slug);
               }
            }
            const openNow = new Map();
            for (const d of [
               ...today.live.flatMap(g => g.open),
               ...today.misc,
               ...today.unsorted,
            ]) {
               const login = d.data.user.login;
               openNow.set(login, (openNow.get(login) || 0) + 1);
            }
            const logins = new Set([...Object.keys(stats.people), ...live.keys()]);
            const people = [...logins].map(login => {
               const w = stats.people[login];
               return {
                  login,
                  window: w
                     ? {
                          backlog_start: w.backlog_start,
                          backlog_end: w.backlog_end,
                          opened: w.opened,
                          merged: w.merged,
                          closed: w.closed,
                          median_age_start_days: w.median_age_start_days,
                          median_age_end_days: w.median_age_end_days,
                       }
                     : null,
                  projects_in_window: w ? w.projects : [],
                  live_projects: (live.get(login) || []).sort(),
                  open_now: openNow.get(login) || 0,
               };
            });
            people.sort(
               (a, b) =>
                  b.live_projects.length - a.live_projects.length ||
                  b.open_now - a.open_now ||
                  a.login.localeCompare(b.login)
            );
            return {
               server_time: Math.floor(now),
               start: stats.start,
               end: stats.end,
               people,
            };
         }),
         'people query failed'
      );
   },
};
