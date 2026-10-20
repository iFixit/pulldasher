import db from './db.js';
import { isBot } from './review-model.js';
import { grew, homesOf, moveBefore, MISC_SLUG } from '../shared/dist/index.js';

/**
 * Initiatives' storage: `initiatives` (name, goal, owner, rank, open or
 * closed) and `initiative_projects`, one row per filed project, keyed by its
 * slug, so a project has one home at most. A project with no row is
 * Unsorted. The shared model (shared/model/initiatives.ts) owns the shape and
 * the checks on what a person sends; this file reads and writes rows, and
 * says which projects are Not tracked and which of those grew.
 */

const COLUMNS =
   '`id`, `slug`, `name`, `kind`, `goal`, `owner_login`, `priority`, `status`, `status_at`, ' +
   '`created_by`, `created_at`, `updated_by`, `updated_at`';

const num = v => (v == null ? null : Number(v));

/** A filing row as the wire's Filing. */
function filingFromRow(row) {
   return {
      project: row.project,
      set_by: row.set_by || null,
      set_at: Number(row.set_at),
      baseline_prs: Number(row.baseline_prs),
   };
}

/** An initiatives row as the wire's Initiative, with the projects filed in it. */
export function initiativeFromRow(row, projects = []) {
   return {
      id: Number(row.id),
      slug: row.slug,
      name: row.name,
      kind: row.kind,
      goal: row.goal || '',
      owner: row.owner_login || null,
      priority: Number(row.priority),
      status: row.status,
      status_at: num(row.status_at),
      created_by: row.created_by || null,
      created_at: num(row.created_at),
      updated_by: row.updated_by || null,
      updated_at: num(row.updated_at),
      projects,
   };
}

/** Every initiative in rank order (lowest first, oldest on a tie), each with
 * the projects filed in it, by slug. */
export async function listInitiatives() {
   const [rows, filings] = await Promise.all([
      db.query(`SELECT ${COLUMNS} FROM \`initiatives\` ORDER BY \`priority\`, \`id\``),
      db.query(
         'SELECT `project`, `initiative_id`, `set_by`, `set_at`, `baseline_prs` ' +
            'FROM `initiative_projects` ORDER BY `project`'
      ),
   ]);
   const byInitiative = new Map();
   for (const f of filings) {
      const id = Number(f.initiative_id);
      if (!byInitiative.has(id)) byInitiative.set(id, []);
      byInitiative.get(id).push(filingFromRow(f));
   }
   return rows.map(r => initiativeFromRow(r, byInitiative.get(Number(r.id)) ?? []));
}

/** One initiative with its projects; null when there's none by that id.
 * ponytail: reads them all; a query of its own past a few hundred. */
export async function getInitiative(id) {
   return (await listInitiatives()).find(i => i.id === id) ?? null;
}

// the wire's field names to the table's
const COLUMN_OF = {
   slug: 'slug',
   name: 'name',
   kind: 'kind',
   goal: 'goal',
   owner: 'owner_login',
   status: 'status',
};

/**
 * Add an initiative, ranked last (as a new plan goes to the bottom).
 * `{ taken: true }` when another already has the slug.
 */
export async function createInitiative(fields, login, now = Math.floor(Date.now() / 1000)) {
   const row = { kind: 'initiative', goal: '', owner_login: null, status: 'open' };
   for (const [key, column] of Object.entries(COLUMN_OF)) {
      if (fields[key] !== undefined) row[column] = fields[key];
   }
   const [{ top }] = await db.query('SELECT MAX(`priority`) AS `top` FROM `initiatives`');
   row.priority = top == null ? 0 : Number(top) + 1;
   row.created_by = row.updated_by = login;
   row.created_at = row.updated_at = now;
   try {
      const { insertId } = await db.query('INSERT INTO `initiatives` SET ?', [row]);
      return getInitiative(insertId);
   } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') return { taken: true };
      throw err;
   }
}

/**
 * Change only the fields sent, and say who did. A change of status says when
 * (status_at); so does `restate`, the same status said again (Keep open,
 * which quiets "Did it reach its goal?" until something in it changes).
 * `undo` puts back the times a change replaced. Null when there's no such
 * initiative.
 */
export async function updateInitiative(
   id,
   fields,
   login,
   { now = Math.floor(Date.now() / 1000), restate = false, undo = null } = {}
) {
   const row = { updated_by: login, updated_at: undo ? undo.updated_at : now };
   for (const [key, value] of Object.entries(fields)) {
      if (COLUMN_OF[key]) row[COLUMN_OF[key]] = value;
   }
   if (undo) row.status_at = undo.status_at;
   else if (fields.status) {
      const [was] = await db.query('SELECT `status` FROM `initiatives` WHERE `id` = ?', [id]);
      if (was && (was.status !== fields.status || restate)) row.status_at = now;
   }
   const result = await db.query('UPDATE `initiatives` SET ? WHERE `id` = ?', [row, id]);
   return result.affectedRows ? getInitiative(id) : null;
}

/**
 * Delete an initiative that holds no projects (the undo of a create), so
 * its slug can be used again. `{ notEmpty: true }` while a project is filed
 * in it, `{ missing: true }` when there's none by that id.
 */
export async function deleteInitiative(id) {
   const result = await db.query(
      'DELETE FROM `initiatives` WHERE `id` = ? AND NOT EXISTS ' +
         '(SELECT 1 FROM `initiative_projects` WHERE `initiative_id` = ?)',
      [id, id]
   );
   if (result.affectedRows) return { ok: true };
   return (await getInitiative(id)) ? { notEmpty: true } : { missing: true };
}

/**
 * Move one initiative to just before another (to the bottom when `beforeId`
 * is null): only initiatives' ranks change, never a plan's priority.
 * `{ missing: true }` when either isn't there.
 */
export async function moveInitiative(id, beforeId) {
   const ids = (await listInitiatives()).map(i => i.id);
   if (!ids.includes(id) || (beforeId != null && !ids.includes(beforeId))) return { missing: true };
   const order = moveBefore(ids, id, beforeId);
   const cases = order.map(() => 'WHEN ? THEN ?').join(' ');
   await db.query(
      `UPDATE \`initiatives\` SET \`priority\` = CASE \`id\` ${cases} END WHERE \`id\` IN (?)`,
      [...order.flatMap((one, i) => [one, i]), order]
   );
   return { initiatives: await listInitiatives() };
}

/** A project's home now: the initiative's slug and kind, and its filing;
 * null when it has none. */
async function homeOf(project) {
   const [row] = await db.query(
      'SELECT f.`project`, f.`set_by`, f.`set_at`, f.`baseline_prs`, i.`slug`, i.`kind` ' +
         'FROM `initiative_projects` f JOIN `initiatives` i ON i.`id` = f.`initiative_id` ' +
         'WHERE f.`project` = ?',
      [project]
   );
   return row ? { initiative: row.slug, kind: row.kind, ...filingFromRow(row) } : null;
}

/**
 * How many PRs carry a project's label, opened after `since` (epoch secs).
 * pull_labels holds issues' labels too, so it counts only rows with a pull.
 * Drafts and bots' PRs don't count, as in every other count (grownSlugs
 * leaves out the same ones, so a baseline and its `since` compare).
 */
export async function prCount(prefix, project, since = 0) {
   const rows = await db.query(
      'SELECT DISTINCT p.`repo`, p.`number`, p.`owner` FROM `pull_labels` l ' +
         'JOIN `pulls` p ON p.`repo` = l.`repo` AND p.`number` = l.`number` ' +
         'WHERE l.`title` = ? AND p.`date` > ? AND p.`draft` = 0',
      [prefix + project, since]
   );
   return rows.filter(r => !isBot(r.owner)).length;
}

/** The project's slug as its label spells it (a PR's or an issue's), so a
 * filing keys the way the board and every map read it; as sent when no
 * label has it yet. */
async function spellingOf(prefix, project) {
   const [row] = await db.query('SELECT `title` FROM `pull_labels` WHERE `title` = ? LIMIT 1', [
      prefix + project,
   ]);
   return row ? row.title.slice(prefix.length) : project;
}

/**
 * File a project in the initiative with slug `to`, or take it out of every
 * one (`to: null`, Unsorted). `expect`, when sent, is the home the person
 * saw (a slug or null): `{ conflict: true, home }` when it's not the one it
 * has now. `{ missing: true }` when `to` names no initiative.
 *
 * Filing into Not tracked writes the growth check's start: `baseline_prs`
 * when sent (the load sends each project's count from GitHub), or else, for
 * a project already not tracked (Keep), its old baseline plus the PRs since
 * it was set, and otherwise its PR count now. `set_at`, sent with
 * `baseline_prs` on an undo, puts the old filing back as it was, so undoing
 * a Keep brings its growth row back rather than restarting the count.
 *
 * `{ untracked: true }` for `to: null` on a project Not tracked by its repos
 * (untrackedSlugs), which no filing makes Unsorted, unless it's an `undo`.
 * `project` comes back as its label spells it, and is stored that way.
 *
 * Resolves `{ project, before, home }`, the homes before and after, for the
 * undo log.
 * ponytail: two people filing one project at once can both pass `expect`;
 * the last write wins, as two saves of a plan do.
 */
export async function fileProject(
   sent,
   to,
   login,
   {
      prefix,
      expect,
      baseline_prs = null,
      set_at = null,
      undo = false,
      untrackedRepos = [],
      now = Math.floor(Date.now() / 1000),
   }
) {
   const project = await spellingOf(prefix, sent);
   const current = await homeOf(project);
   const home = h =>
      h ? { initiative: h.initiative, set_by: h.set_by, set_at: h.set_at, baseline_prs: h.baseline_prs } : null;
   // slugs compare without case, as the columns do
   const lower = v => (v == null ? null : v.toLowerCase());
   if (expect !== undefined && lower(current?.initiative) !== lower(expect)) {
      return { project, conflict: true, home: home(current) };
   }
   const before = home(current) ?? { initiative: null, set_by: null, set_at: null, baseline_prs: 0 };
   if (to == null) {
      // a project whose PRs are all in untrackedRepos reads as Not tracked
      // with no row, so taking its row away can't make it Unsorted. An undo
      // may: it puts back the repo default a filing replaced
      if (!undo && (await untrackedSlugs({ prefix, untrackedRepos }, [])).has(project)) {
         return { project, untracked: true };
      }
      await db.query('DELETE FROM `initiative_projects` WHERE `project` = ?', [project]);
      return { project, before, home: null };
   }
   const [target] = await db.query(
      'SELECT `id`, `kind`, `status`, `slug` FROM `initiatives` WHERE `slug` = ?',
      [to]
   );
   if (!target) return { missing: true };
   // nothing is filed into a closed initiative, as the board's choosers
   // offer open ones only; an undo may put a filing back there. Any set_at
   // counts as an undo too: writers are trusted (canWrite), and the skill
   // sends it only on Undo
   if (target.status !== 'open' && set_at == null && !undo) return { closed: true };
   let baseline = baseline_prs ?? 0;
   if (baseline_prs == null && target.kind === 'untracked') {
      baseline =
         current?.kind === 'untracked'
            ? current.baseline_prs + (await prCount(prefix, project, current.set_at))
            : await prCount(prefix, project);
   }
   const row = {
      project,
      initiative_id: Number(target.id),
      set_by: login,
      set_at: set_at ?? now,
      baseline_prs: baseline,
   };
   await db.query('REPLACE INTO `initiative_projects` SET ?', [row]);
   return {
      project,
      before,
      home: { initiative: target.slug, set_by: login, set_at: row.set_at, baseline_prs: baseline },
   };
}

/**
 * The projects that are Not tracked: filed in an initiative of kind
 * `untracked`, or, with no filing at all, whose every labeled PR is in a
 * repo listed in config.js projects.untrackedRepos (`owner/repo`, or just
 * `repo`). An explicit filing
 * always wins, and one PR elsewhere ends the repo default. Read only when
 * that list names a repo.
 */
export async function untrackedSlugs(settings, initiatives) {
   const homes = homesOf(initiatives);
   const out = new Set(
      [...homes].filter(([, h]) => h.initiative.kind === 'untracked').map(([slug]) => slug)
   );
   const repos = new Set((settings.untrackedRepos ?? []).map(r => r.toLowerCase()));
   if (!repos.size) return out;
   const rows = await db.query(
      'SELECT l.`title`, p.`repo` FROM `pull_labels` l ' +
         'JOIN `pulls` p ON p.`repo` = l.`repo` AND p.`number` = l.`number` ' +
         'WHERE l.`title` LIKE ? GROUP BY l.`title`, p.`repo`',
      [settings.prefix.replace(/[\\%_]/g, '\\$&') + '%']
   );
   const elsewhere = new Set();
   const seen = new Set();
   for (const { title, repo } of rows) {
      const slug = title.slice(settings.prefix.length);
      seen.add(slug);
      // a full name, or the repo's own name
      const name = String(repo).toLowerCase();
      if (!repos.has(name) && !repos.has(name.split('/').pop())) elsewhere.add(slug);
   }
   for (const slug of seen) {
      if (slug && slug !== MISC_SLUG && !elsewhere.has(slug) && !homes.has(slug)) out.add(slug);
   }
   return out;
}

/**
 * The not-tracked projects that grew (shared/model/initiatives.ts grew), by
 * slug, with `since`, the PRs opened since they were set not tracked, and
 * `baseline`, their count then. A repo default has no filing, so it counts
 * from zero. Only PRs opened after set_at count, which Pulldasher stores as
 * they arrive, so a gap in its older history can't make one fire early.
 * ponytail: reads each not-tracked PR's open time and counts here; a
 * grouped query if that list reaches the tens of thousands.
 */
export async function grownSlugs(settings, initiatives, untracked) {
   const out = new Map();
   if (!untracked.size) return out;
   const homes = homesOf(initiatives);
   const rows = await db.query(
      'SELECT DISTINCT l.`title`, p.`repo`, p.`number`, p.`date`, p.`owner` FROM `pull_labels` l ' +
         'JOIN `pulls` p ON p.`repo` = l.`repo` AND p.`number` = l.`number` ' +
         'WHERE l.`title` IN (?) AND p.`draft` = 0',
      [[...untracked].map(slug => settings.prefix + slug)]
   );
   const filingOf = slug => {
      const home = homes.get(slug);
      return home?.initiative.kind === 'untracked' ? home.filing : null;
   };
   const sinceOf = new Map();
   // drafts and bots' PRs don't count, the same as prCount's baseline
   for (const { title, date, owner } of rows) {
      if (isBot(owner)) continue;
      const slug = title.slice(settings.prefix.length);
      if (Number(date) > (filingOf(slug)?.set_at ?? 0)) sinceOf.set(slug, (sinceOf.get(slug) ?? 0) + 1);
   }
   for (const slug of untracked) {
      const since = sinceOf.get(slug) ?? 0;
      const baseline = filingOf(slug)?.baseline_prs ?? 0;
      if (grew(since, baseline)) out.set(slug, { since, baseline });
   }
   return out;
}

/** Everything the counting views need of initiatives at once: every
 * initiative, each project's home, the not-tracked slugs and the grown ones. */
export async function tracking(settings) {
   const initiatives = await listInitiatives();
   const untracked = await untrackedSlugs(settings, initiatives);
   const grown = await grownSlugs(settings, initiatives, untracked);
   return { initiatives, homes: homesOf(initiatives), untracked, grown };
}

/**
 * What counts, with not-tracked projects left out: Today's live and quiet
 * projects, the plans, and an object keyed by slug (a window's per-project
 * numbers), whichever are sent. The one filter every counting endpoint
 * runs, so a not-tracked project can't count in one and not another.
 */
export function trackedOnly(untracked, { today, items, bySlug }) {
   const keep = slug => !slug || !untracked.has(slug);
   return {
      today: today && {
         ...today,
         live: today.live.filter(g => keep(g.slug)),
         quiet: today.quiet.filter(g => keep(g.slug)),
      },
      items: items && items.filter(i => keep(i.project)),
      bySlug: bySlug && Object.fromEntries(Object.entries(bySlug).filter(([slug]) => keep(slug))),
   };
}
