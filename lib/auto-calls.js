import db from './db.js';
import pullManager from './pull-manager.js';
import { isBot } from './review-model.js';
import {
   loadProjects,
   projectSettings,
   pullProjects,
   teamDay,
   todayFromBoard,
} from './projects.js';
import { sharedValue } from './ttl-cache.js';
import { autoWrite, createItem, listItems, noteItem, plannedSlugs } from './roadmap.js';
import { serially, tracking, trackedOnly } from './initiatives.js';
import { loadPullLinks, loadWork } from './work.js';
import {
   autoCalls,
   closedIssues,
   decideProjects,
   dayStart,
   decideQueue,
   issueKey,
   labeledBy,
   AUTO_LOGIN,
   MISC_SLUG,
} from '../shared/dist/index.js';

/**
 * The roadmap calls Pulldasher makes itself (shared/model/autoCalls.ts):
 * read what Decide reads, plus every project's PRs from the tables, and
 * write each call as AUTO_LOGIN with why (lib/roadmap.js autoWrite). Runs
 * after each sync of the projects' work (app.js), which a webhook on a
 * project's issue or the hourly pass starts, when config.js
 * projects.autoCalls is true (it's off by default).
 */

/** Projects that run with no end: marked on the board, or by the `ongoing`
 * label on their issue. */
export function ongoingSlugs(settings, projects) {
   return new Set([...settings.ongoing, ...projects.filter(p => p.ongoing).map(p => p.slug)]);
}

/**
 * Decide's queue now, and what it was read from: the projects, the plans
 * (tracked ones, `items`), today's projects (`fullToday`, not-tracked ones
 * too) and which projects each PR links: what the calls read
 * (callsFrom). `tracked` is lib/initiatives.js tracking's answer.
 */
export async function loadDecide(settings, tracked, { now = Date.now() / 1000 } = {}) {
   const [projects, allItems, linked] = await Promise.all([
      loadProjects(settings),
      listItems(),
      loadPullLinks(settings),
   ]);
   const work = await loadWork(settings, { plans: allItems, projects });
   const fullToday = todayFromBoard(pullManager.getPulls(), projects, settings.prefix, now, linked);
   const { today, items } = trackedOnly(tracked.untracked, { today: fullToday, items: allItems });
   const ongoing = ongoingSlugs(settings, projects);
   const closed = closedIssues(projects);
   const rows = decideQueue({
      live: decideProjects(today),
      items,
      initiatives: tracked.initiatives,
      grown: [...tracked.grown].map(([slug, g]) => ({ slug, ...g })),
      closed,
      planCounts: new Map(
         work.plans.map(p => [
            p.planId,
            {
               openPulls: p.openPulls,
               afterEnd: p.afterEnd.length,
               afterDone: p.afterDone.length,
            },
         ])
      ),
      issues: new Map(Object.entries(work.projects)),
      ongoing,
      // the board's Decide asks by the browser's day: the team's
      today: teamDay(now),
      now,
   });
   return {
      rows,
      projects,
      items,
      fullToday,
      linked,
      ongoing,
      closed,
      untracked: tracked.untracked,
   };
}

const num = v => (v == null ? null : Number(v));

/**
 * Every project's PRs, by slug, people's and no drafts, each in its project
 * by the one rule (projectOf: its label, else the issue it links), with who
 * put its project label on and when (null for one that joins by a link).
 * Reads every PR carrying a project label and every PR a project's issue
 * links, whenever they opened.
 * ponytail: a few thousand rows a sync; bound it by date if the labels grow
 * past tens of thousands.
 */
export async function loadProjectPulls(settings, linked) {
   const like = settings.prefix.replace(/[\\%_]/g, '\\$&') + '%';
   const columns =
      'p.repo, p.number, p.title AS pr_title, p.owner, p.date, p.ready_at, p.date_merged, p.date_pushed, ' +
      'p.state, p.draft';
   const pairs = Object.keys(linked).map(k => {
      const at = k.lastIndexOf('#');
      return [k.slice(0, at), Number(k.slice(at + 1))];
   });
   const [labelRows, linkedRows] = await Promise.all([
      db.query(
         `SELECT ${columns}, l.title, l.user AS label_user, l.date AS label_date FROM pulls p ` +
            'JOIN pull_labels l ON l.repo = p.repo AND l.number = p.number WHERE l.title LIKE ?',
         [like]
      ),
      pairs.length
         ? db.query(`SELECT ${columns} FROM pulls p WHERE (p.repo, p.number) IN (?)`, [pairs])
         : [],
   ]);
   return projectPullsFrom(
      labelRows,
      linkedRows,
      settings.prefix,
      linked,
      settings.machineLabelRuns
   );
}

/** loadProjectPulls's rows by slug (pure, for the tests). `by` says who put
 * the project label on, a person or the job (shared labeledBy, with the
 * machine label `runs`), null for a PR that joins by a link. */
export function projectPullsFrom(labelRows, linkedRows, prefix, linked, runs = []) {
   const slugOf = pullProjects(labelRows, prefix, linked);
   const label = new Map(labelRows.map(r => [`${issueKey(r)} ${r.title}`, r]));
   const rows = new Map([...linkedRows, ...labelRows].map(r => [issueKey(r), r]));
   const out = new Map();
   for (const r of rows.values()) {
      if (r.date == null || Number(r.draft) || isBot(r.owner)) continue;
      const slug = slugOf(r.repo, r.number);
      if (slug == null || slug === MISC_SLUG) continue;
      const put = label.get(`${issueKey(r)} ${prefix}${slug}`);
      const pull = {
         repo: r.repo,
         number: Number(r.number),
         title: r.pr_title,
         author: r.owner,
         opened: Number(r.ready_at ?? r.date),
         merged: num(r.date_merged),
         pushed: num(r.date_pushed),
         open: r.state === 'open',
         labeledAt: put ? num(put.label_date) : null,
         labeledBy: put ? put.label_user ?? null : null,
         by: put ? labeledBy(put.label_user ?? null, num(put.label_date), { isBot, runs }) : null,
      };
      out.set(slug, [...(out.get(slug) ?? []), pull]);
   }
   return out;
}

/** how many of a project's PRs /api/v1/projects names as its examples */
const EXAMPLES = 5;

/**
 * What /api/v1/projects says of a project's PRs for the labeling job:
 * `last_activity`, the team's day (projects.timeZone) its newest PR
 * opened, merged or was pushed to, the activity a plan is put down by, and
 * `examples`, up to EXAMPLES of its labeled PRs that are open or merged
 * (one closed unmerged was no part of it), the ones a person labeled
 * first, then the job's (projectPullsFrom `by`), newest first within each.
 */
export function projectActivity(pulls) {
   const last = Math.max(0, ...pulls.flatMap(p => [p.opened, p.merged ?? 0, p.pushed ?? 0]));
   const recent = p => p.merged ?? p.opened;
   const examples = pulls
      .filter(p => p.by != null && (p.open || p.merged != null))
      .map(p => ({ p, by: p.by }))
      .sort((a, b) => (a.by === b.by ? recent(b.p) - recent(a.p) : a.by === 'person' ? -1 : 1))
      .slice(0, EXAMPLES)
      .map(({ p, by }) => ({
         repo: p.repo,
         number: p.number,
         title: p.title,
         merged_at: p.merged == null ? null : new Date(p.merged * 1000).toISOString(),
         by,
      }));
   return { last_activity: last ? teamDay(last) : null, examples };
}

/** The calls the roadmap owes now, from what loadDecide read (`decide`). */
export async function callsFrom(settings, decide, now = Math.floor(Date.now() / 1000)) {
   const { rows, items, projects, linked, ongoing, closed, untracked } = decide;
   const [pulls, planned] = await Promise.all([loadProjectPulls(settings, linked), plannedSlugs()]);
   return autoCalls({
      rows,
      items,
      pulls,
      planned,
      names: new Map(projects.map(p => [p.slug, p.name])),
      leads: new Map(projects.filter(p => p.lead).map(p => [p.slug, p.lead])),
      ongoing,
      closed,
      untracked,
      idleDays: settings.idleDays,
      settleDays: settings.settleDays,
      timeZone: settings.timeZone,
      now,
   });
}

// whether the last read of the calls failed, so a failing read is logged
// once, not on every Decide and board fetch
let failing = false;

/**
 * The calls, or none when reading them fails: Decide and the board then ask
 * every reason, as with the calls off, rather than failing to load. The
 * failure is logged once until a read works again.
 */
export function callsOrNone(reading) {
   return Promise.resolve()
      .then(reading)
      .then(calls => {
         failing = false;
         return calls;
      })
      .catch(err => {
         if (!failing)
            console.error('Reading the roadmap calls failed: %s', (err && err.message) || err);
         failing = true;
         return [];
      });
}

/**
 * The calls Pulldasher would make now, for the board's Decide to leave out
 * what they answer; none while projects.autoCalls is off. Kept a minute and
 * forgotten on every project write (controllers/roadmap.js
 * forgetProjectCaches), like the other reads open boards share.
 */
const pending = sharedValue(60 * 1000, async () => {
   const settings = projectSettings();
   if (!settings?.autoCalls) return [];
   return callsFrom(settings, await loadDecide(settings, await tracking(settings)));
});
export const pendingCalls = () => callsOrNone(() => pending.get());
export const forgetPendingCalls = () => pending.forget();

/** a run in progress, so a sync finishing during one doesn't start a second */
let running = null;

/**
 * Make the calls the roadmap owes now. With `apply` false it only says
 * what it would do (bin/auto-calls). Resolves the calls, each with
 * `landed`: false when a person's change got there first, or when not
 * applied.
 */
export function runAutoCalls(settings, { apply = true, now = Math.floor(Date.now() / 1000) } = {}) {
   // a dry run says what it would do whether or not the calls are on
   if (!settings || (apply && !settings.autoCalls)) return Promise.resolve([]);
   if (running) return running;
   running = (async () => {
      const decide = await loadDecide(settings, await tracking(settings), { now });
      const calls = await callsFrom(settings, decide, now);
      const out = [];
      for (const call of calls) {
         const landed = apply && (await serially(() => write(call, now)));
         if (landed) console.log('Roadmap call: %s', describe(call));
         out.push({ ...call, landed });
      }
      return out;
   })().finally(() => {
      running = null;
   });
   return running;
}

async function write(call, now) {
   if (call.kind !== 'new') return autoWrite(call, AUTO_LOGIN, now);
   // checked again inside the write chain: a person may have planned it since
   if ((await plannedSlugs()).has(call.fields.project)) return false;
   const item = await createItem(call.fields, AUTO_LOGIN, now);
   await noteItem(item.id, call.note, now);
   return true;
}

/** One call in a line, for the log and the dry run. */
export function describe(call) {
   if (call.kind === 'new')
      return `new plan "${call.fields.name}" (${call.fields.project}): ${call.note}`;
   if (call.kind === 'lead') return `#${call.id} lead ${call.lead}: ${call.note}`;
   return `#${call.id} ${call.from} -> ${call.status}: ${call.note}`;
}

/**
 * The moment bin/auto-calls runs the rules as of: now, or with
 * `--at YYYY-MM-DD` noon UTC on that day, to see the calls a later day
 * brings (the put-downs idleDays after a burst of labels). Throws on a
 * day it can't read.
 */
export function asOf(argv, now = Math.floor(Date.now() / 1000)) {
   const i = argv.indexOf('--at');
   if (i < 0) return now;
   const day = argv[i + 1];
   const start = typeof day === 'string' ? dayStart(day) : null;
   if (start == null) throw new Error('--at takes a day, YYYY-MM-DD');
   return start + 12 * 3600;
}
