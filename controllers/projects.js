import pullManager from '../lib/pull-manager.js';
import { respondOrError } from '../lib/controller-utils.js';
import {
   loadProjects,
   loadTimeSpent,
   loadWindow,
   parseWindow,
   projectSettings,
   todayFromBoard,
} from '../lib/projects.js';
import { listItems } from '../lib/roadmap.js';
import {
   addWeeks,
   closedIssues,
   decideProjects,
   decideQueue,
   decideTurn,
   needsDecision,
   loadByWeek,
   mondayOf,
   mondaysBetween,
   peakFrom,
   planEnd,
   spansFrom,
   utcDay,
   windowStats,
   MISC_SLUG,
   STALL_DAYS,
} from '../shared/dist/index.js';

const key = d => `${d.repo}#${d.number}`;

/**
 * Validate the projects config and the requested window, then load the
 * projects, the window's PR history and its CR/QA stamps. An optional
 * `project` slug narrows the window's numbers and stamps to that project's
 * PRs (the project list stays whole). Answers the request itself (404 when
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
   const only = req.query.project;
   const badProject = only !== undefined && (typeof only !== 'string' || !only || only.length > 64);
   if (window.error || badProject) {
      res.status(400).json({ error: window.error || 'project must be one project slug' });
      return null;
   }
   return Promise.all([
      loadProjects(settings),
      loadWindow(settings, window.start, window.end, only),
   ]).then(([projects, { spans, reviews }]) => ({
      settings,
      projects,
      stats: windowStats(spans, window.start, window.end, {
         teamOf: settings.teamOf,
         reviews,
      }),
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
         fields: p ? p.fields : null,
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

/** Where each project with PRs open began, by slug: the spans that run to today. */
function liveStarts(today) {
   return Object.fromEntries(
      decideProjects(today)
         .filter(p => p.open > 0)
         .map(p => [p.slug, p.firstOpened])
   );
}

export default {
   /**
    * GET /projects-data?start=&end=&project= -- the Projects tab's fetch:
    * every project issue plus the window's numbers (one project's, with
    * `project`). The tab builds Today itself from the live socket pulls, so
    * it moves with the board. Session-authed like /stats-history.
    */
   getBoardData: function (req, res) {
      const loaded = load(req, res);
      if (!loaded) return;
      respondOrError(
         res,
         loaded.then(({ settings, projects, stats }) => ({
            label_prefix: settings.prefix,
            projects_repo: settings.repo,
            teams: settings.teams,
            teams_from: settings.teamsFrom,
            decide_rotation: settings.decideRotation,
            projects,
            window: stats,
         })),
         'projects-data query failed'
      );
   },

   /**
    * GET /api/v1/projects?start=&end= -- every project with its issue fields,
    * where it stands today (open PR ids, people, idle days, flags), and its
    * numbers for the window (default: the last 30 days) -- backlog, throughput,
    * developers vs. non-developers, and median days to merge -- plus the
    * totals and one point per day for the backlog chart. Bearer-authed
    * (lib/api-auth). Dates are YYYY-MM-DD UTC days, both counted;
    * `project=<slug>` narrows the window's numbers to that project's PRs.
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
    * GET /api/v1/people?start=&end= -- per person: their developer team (from
    * config, null if unlisted), the window's numbers, the CR/QA stamps they
    * gave in it and how many landed on a non-developer's PR, the projects
    * they had PRs in during it, the live projects they're on today, and how
    * many PRs they have open now. Someone who only reviewed in the window
    * still gets a row. Most live projects first, which is how a reader spots
    * someone spread thin. Bots are left out.
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
                  team: w ? w.team : settings.teamOf(login),
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
                  reviews: w ? w.reviews : 0,
                  reviews_on_non_dev: w ? w.reviews_on_non_dev : 0,
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

   /**
    * GET /retro-data (session) and /api/v1/retro (Bearer) ?start=&end= --
    * where people's days went in the window: one row per person and PR with
    * their share of active days on it (shared/model/retro.ts), whether they
    * wrote it, and its project. Default: the last 30 days.
    */
   getRetro: function (req, res) {
      const settings = projectSettings();
      if (!settings) {
         res.status(404).json({ error: 'projects are not set up on this Pulldasher' });
         return;
      }
      const window = parseWindow(req.query);
      if (window.error) {
         res.status(400).json({ error: window.error });
         return;
      }
      respondOrError(
         res,
         loadTimeSpent(settings, window.start, window.end).then(({ counted, rows }) => ({
            start: window.start,
            end: window.end,
            // whose time: developers when there are teams, else everyone
            counted,
            rows: rows.map(row => ({ ...row, days: Math.round(row.days * 100) / 100 })),
         })),
         'retro query failed'
      );
   },

   /**
    * GET /api/v1/decide -- the decisions owed now, worst first: what the
    * board's Decide view lists (shared/model/decide.ts). Each row names the
    * project, its roadmap item if it has one, and why it needs a call. A
    * roadmap write clears it: see `decide` in GET /api/v1.
    */
   getDecide: function (req, res) {
      const settings = projectSettings();
      if (!settings) {
         res.status(404).json({ error: 'projects are not set up on this Pulldasher' });
         return;
      }
      respondOrError(
         res,
         Promise.all([loadProjects(settings), listItems()]).then(([projects, items]) => {
            const now = Date.now() / 1000;
            const today = todayFromBoard(pullManager.getPulls(), projects, settings.prefix, now);
            const bySlug = new Map(projects.map(p => [p.slug, p]));
            const open = new Map(today.live.map(g => [g.slug, g.open.length]));
            const rows = decideQueue({
               live: decideProjects(today),
               items,
               closed: closedIssues(projects),
               today: utcDay(now),
               now,
            });
            const day = utcDay(now);
            return {
               server_time: Math.floor(now),
               stall_days: STALL_DAYS,
               // who takes their turn running this list, this week and next
               runs_this_week: decideTurn(settings.decideRotation, day),
               runs_next_week: decideTurn(settings.decideRotation, addWeeks(day, 1)),
               decisions: rows.map(({ slug, item, reasons }) => {
                  const p = slug ? bySlug.get(slug) : undefined;
                  return {
                     project: slug,
                     name: item?.name ?? p?.name ?? slug,
                     lead: item?.lead ?? p?.lead ?? null,
                     open: slug ? open.get(slug) ?? 0 : 0,
                     item: item && {
                        id: item.id,
                        status: item.status,
                        start: item.start,
                        weeks: item.weeks,
                        end: planEnd(item),
                     },
                     reasons,
                  };
               }),
            };
         }),
         'decide query failed'
      );
   },

   /**
    * GET /api/v1/load?start=&end= -- how loaded each week is, against the
    * developers there are: projects in flight on the roadmap and not, from
    * PRs through this week and, after it, as if nothing changes (the plans,
    * plus every open project big enough to owe a decision that has none).
    * Default: the 12 weeks before this one through the 26 after.
    */
   getLoad: function (req, res) {
      const settings = projectSettings();
      if (!settings) {
         res.status(404).json({ error: 'projects are not set up on this Pulldasher' });
         return;
      }
      const now = Date.now() / 1000;
      const day = utcDay(now);
      const thisWeek = mondayOf(day);
      const window = parseWindow({
         start: req.query.start ?? addWeeks(thisWeek, -12),
         end: req.query.end ?? planEnd({ start: thisWeek, weeks: 27 }),
      });
      if (window.error) {
         res.status(400).json({ error: window.error });
         return;
      }
      // the PRs tell the weeks up to today; the plans tell the rest
      const pastEnd = window.end < day ? window.end : day;
      const history =
         window.start <= pastEnd
            ? loadWindow(settings, window.start, pastEnd).then(
                 ({ spans, reviews }) =>
                    windowStats(spans, window.start, pastEnd, { teamOf: settings.teamOf, reviews })
                       .projects
              )
            : Promise.resolve({});
      respondOrError(
         res,
         Promise.all([loadProjects(settings), listItems(), history]).then(
            ([projects, items, past]) => {
               const today = todayFromBoard(pullManager.getPulls(), projects, settings.prefix, now);
               const spans = spansFrom(past, liveStarts(today), window.start);
               // the projects with no plan that owe a decision count ahead
               const closed = closedIssues(projects);
               const ahead = new Set(
                  decideProjects(today)
                     .filter(p => needsDecision(p, closed))
                     .map(p => p.slug)
               );
               const weeks = loadByWeek({
                  weeks: mondaysBetween(window.start, addWeeks(mondayOf(window.end), 1)),
                  today: day,
                  plans: items,
                  spans,
                  ahead,
               });
               const developers = new Set(
                  Object.values(settings.teams)
                     .flat()
                     .map(login => login.toLowerCase())
               ).size;
               const [current] = loadByWeek({
                  weeks: [thisWeek],
                  today: day,
                  plans: items,
                  spans,
                  ahead,
               });
               return {
                  server_time: Math.floor(now),
                  developers,
                  this_week: {
                     week: thisWeek,
                     on_plan: current.onPlan,
                     on_plan_by_origin: current.origins,
                     off_plan: current.offPlan,
                  },
                  peak: peakFrom(weeks, day),
                  weeks: weeks.map(w => ({
                     week: w.week,
                     on_plan: w.onPlan,
                     on_plan_by_origin: w.origins,
                     off_plan: w.offPlan,
                     projected: w.projected,
                  })),
               };
            }
         ),
         'load query failed'
      );
   },
};
