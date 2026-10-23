import db from './db.js';
import pullManager from './pull-manager.js';
import { isBot } from './review-model.js';
import { loadProjects, pullProjects, teamDay, todayFromBoard } from './projects.js';
import { autoWrite, createItem, listItems, noteItem, plannedSlugs } from './roadmap.js';
import { serially, tracking, trackedOnly } from './initiatives.js';
import { loadPullLinks, loadWork } from './work.js';
import {
   autoCalls,
   closedIssues,
   decideProjects,
   decideQueue,
   issueKey,
   labeledBy,
   utcDay,
   AUTO_LOGIN,
   MISC_SLUG,
} from '../shared/dist/index.js';

/**
 * The roadmap calls Pulldasher makes itself (shared/model/autoCalls.ts):
 * read what Decide reads, plus every project's PRs from the tables, and
 * write each call as AUTO_LOGIN with why (lib/roadmap.js autoWrite). Runs
 * after each sync of the projects' work (app.js), which a webhook on a
 * project's issue or the hourly pass starts. projects.autoCalls: false in
 * config.js turns it off.
 */

/** Projects that run with no end: marked on the board, or by the `ongoing`
 * label on their issue. */
export function ongoingSlugs(settings, projects) {
   return new Set([...settings.ongoing, ...projects.filter(p => p.ongoing).map(p => p.slug)]);
}

/**
 * Decide's queue now, and what it was read from: the projects, the plans
 * (tracked ones, `items`), today's projects (`fullToday`, not-tracked ones
 * too) and which projects each PR links. `auto` leaves out what Pulldasher
 * answers itself; the calls read the queue without it. `tracked` is
 * lib/initiatives.js tracking's answer.
 */
export async function loadDecide(settings, tracked, { auto, now = Date.now() / 1000 }) {
   const [projects, allItems, linked] = await Promise.all([
      loadProjects(settings),
      listItems(),
      loadPullLinks(settings),
   ]);
   const work = await loadWork(settings, { plans: allItems, projects });
   const fullToday = todayFromBoard(pullManager.getPulls(), projects, settings.prefix, now, linked);
   const { today, items } = trackedOnly(tracked.untracked, { today: fullToday, items: allItems });
   const ongoing = ongoingSlugs(settings, projects);
   const rows = decideQueue({
      live: decideProjects(today),
      items,
      initiatives: tracked.initiatives,
      grown: [...tracked.grown].map(([slug, g]) => ({ slug, ...g })),
      closed: closedIssues(projects),
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
      auto,
      // the board's Decide asks by the browser's day: the team's
      today: teamDay(now),
      now,
   });
   return { rows, projects, items, fullToday, linked, ongoing };
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
   return projectPullsFrom(labelRows, linkedRows, settings.prefix, linked);
}

/** loadProjectPulls's rows by slug (pure, for the tests). */
export function projectPullsFrom(labelRows, linkedRows, prefix, linked) {
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
      };
      out.set(slug, [...(out.get(slug) ?? []), pull]);
   }
   return out;
}

/** how many of a project's PRs /api/v1/projects names as its examples */
const EXAMPLES = 5;

/**
 * What /api/v1/projects says of a project's PRs for the labeling job:
 * `last_activity`, the day its newest PR opened or merged, and `examples`,
 * up to EXAMPLES of its labeled PRs, the ones a person labeled first, then
 * the job's (shared labeledBy), newest first within each.
 */
export function projectActivity(pulls, runs) {
   const last = Math.max(0, ...pulls.flatMap(p => [p.opened, p.merged ?? 0]));
   const recent = p => p.merged ?? p.opened;
   const examples = pulls
      .filter(p => p.labeledAt != null || p.labeledBy != null)
      .map(p => ({ p, by: labeledBy(p.labeledBy, p.labeledAt, { isBot, runs }) }))
      .sort((a, b) => (a.by === b.by ? recent(b.p) - recent(a.p) : a.by === 'person' ? -1 : 1))
      .slice(0, EXAMPLES)
      .map(({ p, by }) => ({
         repo: p.repo,
         number: p.number,
         title: p.title,
         merged_at: p.merged == null ? null : new Date(p.merged * 1000).toISOString(),
         by,
      }));
   return { last_activity: last ? utcDay(last) : null, examples };
}

/** a run in progress, so a sync finishing during one doesn't start a second */
let running = null;

/**
 * Make the calls the roadmap owes now. With `apply` false it only says
 * what it would do (bin/auto-calls). Resolves the calls, each with
 * `landed`: false when a person's change got there first, or when not
 * applied.
 */
export function runAutoCalls(settings, { apply = true, now = Math.floor(Date.now() / 1000) } = {}) {
   if (!settings || (apply && !settings.autoCalls)) return Promise.resolve([]);
   if (running) return running;
   running = (async () => {
      const tracked = await tracking(settings);
      const { rows, items, projects, linked, ongoing } = await loadDecide(settings, tracked, {
         auto: false,
         now,
      });
      const [pulls, planned] = await Promise.all([
         loadProjectPulls(settings, linked),
         plannedSlugs(),
      ]);
      const calls = autoCalls({
         rows,
         items,
         pulls,
         planned,
         names: new Map(projects.map(p => [p.slug, p.name])),
         leads: new Map(projects.filter(p => p.lead).map(p => [p.slug, p.lead])),
         ongoing,
         idleDays: settings.idleDays,
         now,
      });
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
