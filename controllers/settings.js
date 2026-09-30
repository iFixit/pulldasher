import { projectSettings } from '../lib/projects.js';
import { saveSetting } from '../lib/settings.js';
import {
   checkDecideRotation,
   checkDeveloperTeams,
   mondayOf,
   utcDay,
} from '../shared/dist/index.js';

/** The settings as a reply: each value, and where the teams come from. */
function current() {
   const settings = projectSettings();
   return {
      developer_teams: settings.teams,
      decide_rotation: settings.decideRotation,
      from: { developer_teams: settings.teamsFrom },
   };
}

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);

export default {
   /** GET /settings (session) and /api/v1/settings (Bearer) -- the settings
    * people can change, and whether each is saved or config.js's. */
   get: function (req, res) {
      if (!projectSettings()) {
         return res.status(404).json({ error: 'projects are not set up in config.js' });
      }
      res.json(current());
   },

   /**
    * PATCH /settings and /api/v1/settings {developer_teams?, decide_rotation?}
    * -- replace the developer teams (null goes back to config.js's), or who
    * takes turns running Decide, starting with the first this week (null for
    * nobody). Behind canWrite (controllers/roadmap.js), so it takes JSON from
    * a signed-in person or a Bearer caller, and records who.
    */
   update: function (req, res) {
      if (!projectSettings()) {
         return res.status(404).json({ error: 'projects are not set up in config.js' });
      }
      const body = req.body || {};
      if (!has(body, 'developer_teams') && !has(body, 'decide_rotation')) {
         return res.status(400).json({
            error:
               'send developer_teams (an object of team name to logins, or null) or ' +
               'decide_rotation (a list of logins, or null)',
         });
      }
      const saves = [];
      if (has(body, 'developer_teams')) {
         const checked = checkDeveloperTeams(body.developer_teams);
         if (checked.error) return res.status(400).json({ error: checked.error });
         saves.push(['developer_teams', checked.teams]);
      }
      if (has(body, 'decide_rotation')) {
         const checked = checkDecideRotation(body.decide_rotation);
         if (checked.error) return res.status(400).json({ error: checked.error });
         const from = mondayOf(utcDay(Date.now() / 1000));
         saves.push(['decide_rotation', checked.logins && { logins: checked.logins, from }]);
      }
      saves
         .reduce(
            (done, [name, value]) => done.then(() => saveSetting(name, value, req.roadmapLogin)),
            Promise.resolve()
         )
         .then(() => res.json(current()))
         .catch(err => {
            console.error('settings save failed:', err);
            res.status(500).json({ error: 'settings save failed' });
         });
   },
};
