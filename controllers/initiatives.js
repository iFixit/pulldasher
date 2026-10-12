import pullManager from '../lib/pull-manager.js';
import { respondOrError } from '../lib/controller-utils.js';
import { loadProjects, projectSettings, todayFromBoard } from '../lib/projects.js';
import { listItems } from '../lib/roadmap.js';
import { loadPullLinks } from '../lib/work.js';
import {
   createInitiative,
   deleteInitiative,
   fileProject,
   getInitiative,
   listInitiatives,
   moveInitiative,
   updateInitiative,
} from '../lib/initiatives.js';
import { undoTimes } from './roadmap.js';
import {
   checkInitiativeFields,
   goingProjects,
   initiativeSpan,
   DEFAULT_PROJECT_PREFIX,
   PROJECT_SLUG,
} from '../shared/dist/index.js';

/** The :id param as a positive integer, or null. */
function idOf(req) {
   const id = Number(req.params.id);
   return Number.isInteger(id) && id > 0 ? id : null;
}

/** Initiatives as they're sent: each with its span, read off the plans of
 * the projects in it (shared/model/initiatives.ts initiativeSpan). */
async function sent(initiatives, items) {
   const plans = items ?? (await listItems());
   return initiatives.map(i => ({
      ...i,
      span: initiativeSpan(
         i.projects.map(f => f.project),
         plans
      ),
   }));
}

/**
 * The projects in an initiative still going (goingProjects: a plan under
 * way, or PRs open on the board), by the same rule Decide asks by. An
 * initiative closes only once none is left.
 */
async function liveProjects(initiative) {
   const settings = projectSettings();
   const open = new Map();
   if (settings) {
      const [projects, linked] = await Promise.all([loadProjects(settings), loadPullLinks(settings)]);
      const today = todayFromBoard(pullManager.getPulls(), projects, settings.prefix, undefined, linked);
      for (const g of today.live) open.set(g.slug, g.open.length);
   }
   return goingProjects(
      initiative.projects.map(f => f.project),
      await listItems(),
      slug => open.get(slug) ?? 0
   );
}

/** A failed write's 500, logged. */
function failed(res, what) {
   return err => {
      console.error(`initiative ${what} failed:`, err);
      res.status(500).json({ error: `initiative ${what} failed` });
   };
}

export default {
   /**
    * GET /initiatives (session) and GET /api/v1/initiatives (Bearer) --
    * every initiative in rank order, with the projects filed in it and its
    * span read off their plans.
    */
   list: function (req, res) {
      respondOrError(
         res,
         listInitiatives()
            .then(all => sent(all))
            .then(initiatives => ({ initiatives })),
         'initiatives query failed'
      );
   },

   /** POST /initiatives {slug, name, goal?, owner?, kind?} -- a new one,
    * ranked last. 201 with it; 409 when the slug is taken. */
   create: function (req, res) {
      const checked = checkInitiativeFields(req.body, { partial: false });
      if (checked.error) return res.status(400).json({ error: checked.error });
      createInitiative(checked.fields, req.roadmapLogin)
         .then(async made => {
            if (made.taken) {
               return res.status(409).json({ error: 'another initiative has that slug' });
            }
            res.status(201).json({ initiative: (await sent([made]))[0] });
         })
         .catch(failed(res, 'create'));
   },

   /**
    * PATCH /initiatives/:id {name?, goal?, owner?, status?} -- changes just
    * those. Closing (done or dropped) is refused with 409 while a project
    * in it has a plan under way or PRs open, naming them (`live`), so the
    * person moves or finishes each first. `restate: true` with the status
    * it has stamps the status anew (Keep open); `undo: {updated_at,
    * status_at}` puts back the times a change replaced.
    */
   update: function (req, res) {
      const id = idOf(req);
      if (!id) return res.status(400).json({ error: 'the id must be a positive whole number' });
      const { restate, undo, ...body } = req.body ?? {};
      const checked = checkInitiativeFields(body, { partial: true });
      if (checked.error) return res.status(400).json({ error: checked.error });
      (async () => {
         const was = await getInitiative(id);
         if (!was) return res.status(404).json({ error: 'no such initiative' });
         const closing = checked.fields.status && checked.fields.status !== 'open';
         if (closing && was.status === 'open') {
            const live = await liveProjects(was);
            if (live.length) {
               return res
                  .status(409)
                  .json({ error: 'move or finish the projects still going in it first', live });
            }
         }
         const changed = await updateInitiative(id, checked.fields, req.roadmapLogin, {
            restate: restate === true,
            undo: undoTimes(undo),
         });
         if (!changed) return res.status(404).json({ error: 'no such initiative' });
         res.json({ initiative: (await sent([changed]))[0] });
      })().catch(failed(res, 'update'));
   },

   /** DELETE /initiatives/:id -- only one with no projects in it (the undo
    * of a create); 409 while it holds any. */
   remove: function (req, res) {
      const id = idOf(req);
      if (!id) return res.status(400).json({ error: 'the id must be a positive whole number' });
      deleteInitiative(id)
         .then(result => {
            if (result.missing) return res.status(404).json({ error: 'no such initiative' });
            if (result.notEmpty) {
               return res
                  .status(409)
                  .json({ error: 'it still holds projects: file them elsewhere first' });
            }
            res.json({ ok: true });
         })
         .catch(failed(res, 'delete'));
   },

   /** POST /initiatives/:id/move {before} -- just above initiative
    * `before`, or the bottom for null. Only initiatives' ranks change. */
   move: function (req, res) {
      const id = idOf(req);
      if (!id) return res.status(400).json({ error: 'the id must be a positive whole number' });
      const before = req.body ? req.body.before : undefined;
      if (before !== null && !(Number.isInteger(before) && before > 0)) {
         return res
            .status(400)
            .json({ error: 'send before as the id to move above, or null for the bottom' });
      }
      moveInitiative(id, before)
         .then(async result => {
            if (result.missing) return res.status(404).json({ error: 'no such initiative' });
            res.json({ initiatives: await sent(result.initiatives) });
         })
         .catch(failed(res, 'move'));
   },

   /**
    * PUT /initiatives/file {project, initiative, expect?, baseline_prs?,
    * set_at?} -- file a project in the initiative with that slug, or in none
    * (null: Unsorted). `expect` is the home the person saw (a slug or null):
    * 409 with the one it has now (`home`) when that's stale. Answers
    * `before` and `home` (initiative, set_by, set_at, baseline_prs), so an
    * undo sends `before` back with `set_at` and `baseline_prs`. A closed
    * initiative is a 409, except for an undo (`set_at`) putting a filing back.
    */
   file: function (req, res) {
      const body = req.body ?? {};
      const { project, initiative, expect } = body;
      if (typeof project !== 'string' || !PROJECT_SLUG.test(project)) {
         return res.status(400).json({ error: 'send project, a project label’s slug' });
      }
      const slug = v => v === null || (typeof v === 'string' && PROJECT_SLUG.test(v));
      if (!slug(initiative) || (expect !== undefined && !slug(expect))) {
         return res
            .status(400)
            .json({ error: 'send initiative (and expect) as an initiative’s slug, or null for none' });
      }
      const count = v => v == null || (Number.isInteger(v) && v >= 0);
      const now = Math.floor(Date.now() / 1000);
      const when = v => v == null || (Number.isInteger(v) && v > 0 && v <= now);
      if (!count(body.baseline_prs) || !when(body.set_at)) {
         return res.status(400).json({
            error: 'baseline_prs is a count of PRs, and set_at a time in the past in epoch seconds',
         });
      }
      const settings = projectSettings();
      fileProject(project, initiative, req.roadmapLogin, {
         prefix: settings?.prefix ?? DEFAULT_PROJECT_PREFIX,
         expect,
         baseline_prs: body.baseline_prs ?? null,
         set_at: body.set_at ?? null,
         now,
      })
         .then(result => {
            if (result.missing) return res.status(404).json({ error: 'no initiative has that slug' });
            if (result.closed) {
               return res
                  .status(409)
                  .json({ error: 'that initiative is closed; reopen it before filing a project in it' });
            }
            if (result.conflict) {
               return res
                  .status(409)
                  .json({ error: 'its home changed; here it is now', home: result.home });
            }
            res.json({ project, before: result.before, home: result.home });
         })
         .catch(failed(res, 'filing'));
   },
};
