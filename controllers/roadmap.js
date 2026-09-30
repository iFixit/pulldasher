import { respondOrError } from '../lib/controller-utils.js';
import { createItem, deleteItem, listItems, reorderItems, updateItem } from '../lib/roadmap.js';
import { checkRoadmapFields } from '../shared/dist/index.js';

const FAKE_USER = process.env.MOCK_AUTH_AS_USER;

/**
 * The gate on every roadmap write. A signed-in session is the only way in
 * (401 otherwise), and the body must be JSON (415 otherwise): a JSON write
 * from another site needs a CORS preflight, which this server never answers,
 * so a cross-site form post can't change the roadmap on someone's behalf.
 */
export function canWrite(req, res, next) {
   const signedIn = typeof req.isAuthenticated === 'function' && req.isAuthenticated();
   if (!signedIn && !FAKE_USER) {
      return res.status(401).json({ error: 'sign in to change the roadmap' });
   }
   if (req.method !== 'DELETE' && !req.is('application/json')) {
      return res.status(415).json({ error: 'send the change as JSON' });
   }
   req.roadmapLogin = signedIn ? req.user.username : FAKE_USER;
   next();
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
    * each with its first week, length in weeks, and an optional project label
    * slug linking it to that project's PRs.
    */
   list: function (req, res) {
      respondOrError(
         res,
         listItems().then(items => ({ items })),
         'roadmap query failed'
      );
   },

   /**
    * POST /roadmap {name, project?, team?, lead?, status?, start?, weeks?,
    * notes?} -- a new item at the bottom of the order. 201 with the item.
    */
   create: function (req, res) {
      const checked = checkRoadmapFields(req.body, { partial: false });
      if (checked.error) return res.status(400).json({ error: checked.error });
      createItem(checked.fields, req.roadmapLogin)
         .then(item => res.status(201).json({ item }))
         .catch(err => {
            console.error('roadmap create failed:', err);
            res.status(500).json({ error: 'roadmap create failed' });
         });
   },

   /** PATCH /roadmap/:id with any of the item's fields -- changes just those. */
   update: function (req, res) {
      const id = idOf(req);
      if (!id) return res.status(400).json({ error: 'the id must be a positive whole number' });
      const checked = checkRoadmapFields(req.body, { partial: true });
      if (checked.error) return res.status(400).json({ error: checked.error });
      updateItem(id, checked.fields, req.roadmapLogin)
         .then(item =>
            item ? res.json({ item }) : res.status(404).json({ error: 'no such roadmap item' })
         )
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
