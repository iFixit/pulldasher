import pullManager from '../lib/pull-manager.js';
import { respondOrError } from '../lib/controller-utils.js';
import { loadProjects, projectSettings, teamDay, todayFromBoard } from '../lib/projects.js';
import {
   addUpdate,
   createItem,
   deleteUpdate,
   getItem,
   latelyBySlug,
   listItems,
   listUpdates,
   moveItem,
   removeItem,
   reorderItems,
   restoreItem,
   updateItem,
} from '../lib/roadmap.js';
import { sharedValue } from '../lib/ttl-cache.js';
import { loadPullLinks, loadWork } from '../lib/work.js';
import {
   checkRoadmapFields,
   checkRoadmapUpdate,
   healthStanding,
   inProgress,
   planFor,
   updatesOwed,
   updateStanding,
   waitsOnProblem,
} from '../shared/dist/index.js';

const FAKE_USER = process.env.MOCK_AUTH_AS_USER;

/** how long what the projects did lately is kept: the roadmap reloads each
 * minute an open board shows it, and once is enough for all of them. A
 * project write forgets it (forgetProjectCaches). */
const LATELY_MS = 60 * 1000;

/**
 * What each project did lately, by slug (lib/roadmap.js latelyBySlug): the
 * board's PRs now, each in its project by the same rule as Today's
 * (controllers/projects.js), and its issues' pace from the work model when
 * it sends one (`pace`, by slug). Empty when projects aren't set up.
 */
const latelyNow = sharedValue(LATELY_MS, async () => {
   const settings = projectSettings();
   if (!settings) return new Map();
   const [projects, linked] = await Promise.all([
      loadProjects(settings),
      loadPullLinks(settings),
   ]);
   const work = await loadWork(settings, { plans: [], projects }).catch(err => {
      console.error('roadmap: reading the issues’ pace failed:', err);
      return null;
   });
   const now = Date.now() / 1000;
   const ongoing = new Set([
      ...settings.ongoing,
      ...projects.filter(p => p.ongoing).map(p => p.slug),
   ]);
   const pulls = pullManager.getPulls();
   const today = todayFromBoard(pulls, projects, settings.prefix, now, linked);
   return latelyBySlug(today, work?.pace ?? {}, ongoing, now);
});

/** What each project did lately (latelyNow); empty when the reads fail:
 * every plan is then judged by its updates alone, as before. */
async function lately() {
   try {
      return await latelyNow.get();
   } catch (err) {
      console.error('roadmap: reading what projects did lately failed:', err);
      return new Map();
   }
}

/**
 * Items as the roadmap sends them: each with what its project did lately
 * (shared/model/roadmap.ts PlanLately), and what the board reads off it, so
 * a script says what the board says: `in_progress` (marked so, or planned
 * with its PRs moving since its start: inProgress) and `standing`, where its
 * updates stand (updateStanding: owed, vouched or current), judged by the
 * team's day.
 */
async function sent(items) {
   const bySlug = await lately();
   const now = Date.now() / 1000;
   const today = teamDay(now);
   return items.map(item => {
      const read = { ...item, lately: (item.project && bySlug.get(item.project)) || null };
      return {
         ...read,
         in_progress: inProgress(read),
         standing: updateStanding(healthStanding(read, now, today)),
      };
   });
}

/** One item as the roadmap sends it; null stays null. */
const sentOne = async item => (item ? (await sent([item]))[0] : null);

/** how long the review board's project standing is kept; a project write
 * forgets it */
const STANDING_MS = 60 * 1000;

/**
 * What the review board needs to know of projects: which projects each of
 * its PRs links (lib/work.js loadPullLinks), so it files a PR in its project
 * by the Projects tab's rule, and each project's plan (shared/model/roadmap.ts
 * planFor) by slug: its status, and whether it's in progress by its PRs
 * (inProgress), so a parked one's PRs sink and one under way can finish,
 * and its name, for the board to say which.
 */
const standingNow = sharedValue(STANDING_MS, async () => {
   const settings = projectSettings();
   const [linked, items] = await Promise.all([loadPullLinks(settings), listItems().then(sent)]);
   // the board's PRs: open, and closed lately
   const onBoard = new Set(
      pullManager.getPulls().map(p => `${p.data.repo}#${p.data.number}`.toLowerCase())
   );
   const plans = {};
   for (const slug of new Set(items.map(i => i.project).filter(Boolean))) {
      const plan = planFor(slug, items);
      plans[slug] = { status: plan.status, in_progress: plan.in_progress, name: plan.name };
   }
   return {
      pull_links: Object.fromEntries(Object.entries(linked).filter(([pr]) => onBoard.has(pr))),
      plans,
   };
});

/** Forget what's kept of the projects: a project write, or a sync of the
 * issues and their links, changed it (app.js). */
export function forgetProjectCaches() {
   latelyNow.forget();
   standingNow.forget();
}

/**
 * The gate on every roadmap write. The writer is the /api/v1 caller whose
 * Bearer token lib/api-auth.js already checked, or else a signed-in board
 * session (401 when neither). The body must be JSON (415 otherwise): a JSON
 * write from another site needs a CORS preflight, which this server never
 * answers, so a cross-site form post can't change the roadmap on someone's
 * behalf.
 */
export function canWrite(req, res, next) {
   const signedIn = typeof req.isAuthenticated === 'function' && req.isAuthenticated();
   const login = req.apiUser?.login ?? (signedIn ? req.user.username : FAKE_USER);
   if (!login) {
      return res.status(401).json({ error: 'sign in to make changes' });
   }
   if (req.method !== 'DELETE' && !req.is('application/json')) {
      return res.status(415).json({ error: 'send the change as JSON' });
   }
   req.roadmapLogin = login;
   next();
}

/**
 * Why item `id` (null for a new one) can't wait on what `fields` says, in
 * words; null when it can, or when the fields don't touch waits_on.
 * ponytail: two people saving at once could still close a loop; it would
 * only show both items as clashing, so no lock.
 */
async function waitsOnError(id, fields) {
   if (!fields.waits_on) return null;
   return waitsOnProblem(id, fields.waits_on, await listItems());
}

/** The :id param as a positive integer, or null. */
function idOf(req) {
   const id = Number(req.params.id);
   return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The times an Undo puts back: whole seconds, none in the future (a time from
 * the future would hide every call until it passed). Null when the body
 * sends none or they don't check out.
 */
function undoTimes(undo, now = Math.floor(Date.now() / 1000)) {
   if (!undo || typeof undo !== 'object') return null;
   const ok = t => Number.isInteger(t) && t > 0 && t <= now;
   if (!ok(undo.updated_at)) return null;
   if (undo.status_at != null && !ok(undo.status_at)) return null;
   return { updated_at: undo.updated_at, status_at: undo.status_at ?? null };
}

export default {
   /**
    * GET /roadmap (session) and GET /api/v1/roadmap (Bearer) -- every
    * roadmap item in priority order: the plan a project manager laid out,
    * each with its first week, length in weeks, an optional project label
    * slug linking it to that project's PRs, its latest update, what its
    * project did lately, and what the board reads off them (`sent`).
    */
   list: function (req, res) {
      respondOrError(
         res,
         listItems()
            .then(sent)
            .then(items => ({ items })),
         'roadmap query failed'
      );
   },

   /**
    * GET /project-standing (session) -- the review board's view of projects
    * (standingNow): which projects each of its PRs links, and each project's
    * plan's status and whether it's in progress, by slug.
    */
   standing: function (req, res) {
      if (!projectSettings()) {
         res.status(404).json({ error: 'projects are not set up on this Pulldasher' });
         return;
      }
      respondOrError(res, standingNow.get(), 'project standing query failed');
   },

   /**
    * GET /api/v1/updates-owed -- the leads who owe an update, each with the
    * plans in progress they haven't updated for UPDATE_DUE_DAYS, longest
    * overdue first: what a reminder would send each of them. A plan whose
    * PRs merged lately, inside its end and its issues' pace, owes none
    * (shared/model/roadmap.ts vouchFor), as on the board, by the team's day.
    */
   owed: function (req, res) {
      const now = Math.floor(Date.now() / 1000);
      respondOrError(
         res,
         listItems().then(sent).then(items => ({
            server_time: now,
            leads: updatesOwed(items, now, teamDay(now)).map(({ lead, owed }) => ({
               lead,
               plans: owed.map(({ item, kind, days }) => ({
                  id: item.id,
                  name: item.name,
                  project: item.project,
                  // never updated, or not for a while
                  owes: kind === 'missing' ? 'a first update' : 'a new update',
                  days,
               })),
            })),
         })),
         'updates query failed'
      );
   },

   /**
    * POST /roadmap {name, project?, team?, lead?, status?, start?, weeks?,
    * notes?, waits_on?} -- a new item at the bottom of the order, or for a
    * project, where its issue's Priority field puts it, starting on its Start
    * date when no start is sent (lib/roadmap.js createItem). 201 with the
    * item.
    */
   create: function (req, res) {
      const checked = checkRoadmapFields(req.body, { partial: false });
      if (checked.error) return res.status(400).json({ error: checked.error });
      waitsOnError(null, checked.fields)
         .then(async error => {
            if (error) return res.status(400).json({ error });
            const item = await createItem(checked.fields, req.roadmapLogin);
            res.status(201).json({ item: await sentOne(item) });
         })
         .catch(err => {
            console.error('roadmap create failed:', err);
            res.status(500).json({ error: 'roadmap create failed' });
         });
   },

   /** GET /api/v1/roadmap/:id -- one item with its latest update. */
   get: function (req, res) {
      const id = idOf(req);
      if (!id) return res.status(400).json({ error: 'the id must be a positive whole number' });
      getItem(id)
         .then(sentOne)
         .then(item =>
            item ? res.json({ item }) : res.status(404).json({ error: 'no such roadmap item' })
         )
         .catch(err => {
            console.error('roadmap get failed:', err);
            res.status(500).json({ error: 'roadmap get failed' });
         });
   },

   /**
    * POST /api/v1/roadmap/:id/move {before} -- put the item just before
    * item `before`, or at the bottom for `before: null`. 409 with the list
    * as it is now if someone added or removed an item at the same moment.
    */
   move: function (req, res) {
      const id = idOf(req);
      if (!id) return res.status(400).json({ error: 'the id must be a positive whole number' });
      const before = req.body ? req.body.before : undefined;
      if (before !== null && !(Number.isInteger(before) && before > 0)) {
         return res
            .status(400)
            .json({ error: 'send before as the id to move above, or null for the bottom' });
      }
      moveItem(id, before)
         .then(async result => {
            if (result.missing) return res.status(404).json({ error: 'no such roadmap item' });
            const items = await sent(result.items);
            if (result.conflict) {
               return res.status(409).json({ error: 'the roadmap changed; here it is again', items });
            }
            res.json({ items });
         })
         .catch(err => {
            console.error('roadmap move failed:', err);
            res.status(500).json({ error: 'roadmap move failed' });
         });
   },

   /** PATCH /roadmap/:id with any of the item's fields -- changes just those.
    * `restate: true` says a status sent as it already was is a call made
    * again; `undo: { updated_at, status_at }` puts back the times a call
    * replaced. `restore: true`, alone, puts back an item removed by mistake
    * (Remove's Undo), as it was. */
   update: function (req, res) {
      const id = idOf(req);
      if (!id) return res.status(400).json({ error: 'the id must be a positive whole number' });
      if (req.body?.restore === true) {
         return restoreItem(id)
            .then(sentOne)
            .then(item =>
               item
                  ? res.json({ item })
                  : res.status(404).json({ error: 'no removed roadmap item by that id' })
            )
            .catch(err => {
               console.error('roadmap restore failed:', err);
               res.status(500).json({ error: 'roadmap restore failed' });
            });
      }
      const checked = checkRoadmapFields(req.body, { partial: true });
      if (checked.error) return res.status(400).json({ error: checked.error });
      waitsOnError(id, checked.fields)
         .then(async error => {
            if (error) return res.status(400).json({ error });
            const item = await updateItem(id, checked.fields, req.roadmapLogin, {
               restate: req.body?.restate === true,
               undo: undoTimes(req.body?.undo),
            });
            if (item) res.json({ item: await sentOne(item) });
            else res.status(404).json({ error: 'no such roadmap item' });
         })
         .catch(err => {
            console.error('roadmap update failed:', err);
            res.status(500).json({ error: 'roadmap update failed' });
         });
   },

   /** DELETE /roadmap/:id -- takes the item off the roadmap. Its row and
    * updates are kept, so PATCH with `restore: true` puts it back. */
   remove: function (req, res) {
      const id = idOf(req);
      if (!id) return res.status(400).json({ error: 'the id must be a positive whole number' });
      removeItem(id)
         .then(gone =>
            gone ? res.json({ ok: true }) : res.status(404).json({ error: 'no such roadmap item' })
         )
         .catch(err => {
            console.error('roadmap delete failed:', err);
            res.status(500).json({ error: 'roadmap delete failed' });
         });
   },

   /** GET /roadmap/:id/updates (session) and /api/v1/roadmap/:id/updates
    * (Bearer) -- the item's updates, newest first. */
   updates: function (req, res) {
      const id = idOf(req);
      if (!id) return res.status(400).json({ error: 'the id must be a positive whole number' });
      respondOrError(
         res,
         listUpdates(id).then(updates => ({ updates })),
         'roadmap updates query failed'
      );
   },

   /**
    * POST /roadmap/:id/updates {health, body?} -- a new update on the item,
    * with the plan as it stands kept beside it. 201 with the update.
    */
   postUpdate: function (req, res) {
      const id = idOf(req);
      if (!id) return res.status(400).json({ error: 'the id must be a positive whole number' });
      const checked = checkRoadmapUpdate(req.body);
      if (checked.error) return res.status(400).json({ error: checked.error });
      addUpdate(id, checked.fields, req.roadmapLogin)
         .then(update =>
            update
               ? res.status(201).json({ update })
               : res.status(404).json({ error: 'no such roadmap item' })
         )
         .catch(err => {
            console.error('roadmap update post failed:', err);
            res.status(500).json({ error: 'roadmap update post failed' });
         });
   },

   /**
    * DELETE /roadmap/:id/updates/:update -- takes back an update the caller
    * posted (the Undo beside a post): 200 with the item's latest update now,
    * the one before it, or null. 403 for someone else's update; 404 when
    * the item has no such update.
    */
   removeUpdate: function (req, res) {
      const id = idOf(req);
      const updateId = Number(req.params.update);
      if (!id || !Number.isInteger(updateId) || updateId <= 0) {
         return res.status(400).json({ error: 'the ids must be positive whole numbers' });
      }
      deleteUpdate(id, updateId, req.roadmapLogin)
         .then(result => {
            if (result.missing) {
               return res.status(404).json({ error: 'no such update on that item' });
            }
            if (result.notYours) {
               return res
                  .status(403)
                  .json({ error: 'only the person who posted an update can take it back' });
            }
            res.json({ update: result.latest });
         })
         .catch(err => {
            console.error('roadmap update delete failed:', err);
            res.status(500).json({ error: 'roadmap update delete failed' });
         });
   },

   /**
    * PUT /roadmap/order {ids} -- the whole order, top first. It has to name
    * every item once; if the list changed since the person loaded it, 409
    * with the list as it is now, so their board can catch up before retrying.
    */
   reorder: function (req, res) {
      const ids = req.body && req.body.ids;
      if (!Array.isArray(ids) || !ids.every(id => Number.isInteger(id) && id > 0)) {
         return res.status(400).json({ error: 'send ids as a list of item ids, top first' });
      }
      reorderItems(ids)
         .then(async result => {
            const items = await sent(result.items);
            if (result.conflict) {
               return res.status(409).json({ error: 'the roadmap changed; here it is again', items });
            }
            res.json({ items });
         })
         .catch(err => {
            console.error('roadmap reorder failed:', err);
            res.status(500).json({ error: 'roadmap reorder failed' });
         });
   },
};
