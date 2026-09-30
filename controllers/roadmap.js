import { respondOrError } from '../lib/controller-utils.js';
import {
   addUpdate,
   createItem,
   deleteItem,
   getItem,
   listItems,
   listUpdates,
   moveItem,
   reorderItems,
   updateItem,
} from '../lib/roadmap.js';
import {
   checkRoadmapFields,
   checkRoadmapUpdate,
   updatesOwed,
   waitsOnProblem,
} from '../shared/dist/index.js';

const FAKE_USER = process.env.MOCK_AUTH_AS_USER;

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

export default {
   /**
    * GET /roadmap (session) and GET /api/v1/roadmap (Bearer) -- every
    * roadmap item in priority order: the plan a project manager laid out,
    * each with its first week, length in weeks, an optional project label
    * slug linking it to that project's PRs, and its latest update.
    */
   list: function (req, res) {
      respondOrError(
         res,
         listItems().then(items => ({ items })),
         'roadmap query failed'
      );
   },

   /**
    * GET /api/v1/updates-owed -- the leads who owe an update, each with the
    * plans in progress they haven't updated for UPDATE_DUE_DAYS, longest
    * overdue first: what a reminder would send each of them.
    */
   owed: function (req, res) {
      const now = Math.floor(Date.now() / 1000);
      respondOrError(
         res,
         listItems().then(items => ({
            server_time: now,
            leads: updatesOwed(items, now).map(({ lead, owed }) => ({
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
    * notes?, waits_on?} -- a new item at the bottom of the order. 201 with
    * the item.
    */
   create: function (req, res) {
      const checked = checkRoadmapFields(req.body, { partial: false });
      if (checked.error) return res.status(400).json({ error: checked.error });
      waitsOnError(null, checked.fields)
         .then(async error => {
            if (error) return res.status(400).json({ error });
            res.status(201).json({ item: await createItem(checked.fields, req.roadmapLogin) });
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
         .then(result => {
            if (result.missing) return res.status(404).json({ error: 'no such roadmap item' });
            if (result.conflict) {
               return res
                  .status(409)
                  .json({ error: 'the roadmap changed; here it is again', items: result.items });
            }
            res.json({ items: result.items });
         })
         .catch(err => {
            console.error('roadmap move failed:', err);
            res.status(500).json({ error: 'roadmap move failed' });
         });
   },

   /** PATCH /roadmap/:id with any of the item's fields -- changes just those. */
   update: function (req, res) {
      const id = idOf(req);
      if (!id) return res.status(400).json({ error: 'the id must be a positive whole number' });
      const checked = checkRoadmapFields(req.body, { partial: true });
      if (checked.error) return res.status(400).json({ error: checked.error });
      waitsOnError(id, checked.fields)
         .then(async error => {
            if (error) return res.status(400).json({ error });
            const item = await updateItem(id, checked.fields, req.roadmapLogin);
            if (item) res.json({ item });
            else res.status(404).json({ error: 'no such roadmap item' });
         })
         .catch(err => {
            console.error('roadmap update failed:', err);
            res.status(500).json({ error: 'roadmap update failed' });
         });
   },

   /** DELETE /roadmap/:id -- removes the item. */
   remove: function (req, res) {
      const id = idOf(req);
      if (!id) return res.status(400).json({ error: 'the id must be a positive whole number' });
      deleteItem(id)
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
         .then(result =>
            result.conflict
               ? res.status(409).json({ error: 'the roadmap changed; here it is again', items: result.items })
               : res.json({ items: result.items })
         )
         .catch(err => {
            console.error('roadmap reorder failed:', err);
            res.status(500).json({ error: 'roadmap reorder failed' });
         });
   },
};
