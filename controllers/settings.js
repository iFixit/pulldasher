import { projectSettings } from '../lib/projects.js';
import { saveSetting } from '../lib/settings.js';
import { checkDeveloperTeams } from '../shared/dist/index.js';

/** The settings as a reply: each value, and where it comes from. */
function current() {
   const settings = projectSettings();
   return {
      developer_teams: settings.teams,
      from: { developer_teams: settings.teamsFrom },
   };
}

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
    * PATCH /settings and /api/v1/settings {developer_teams} -- replace the
    * developer teams, or with null go back to config.js's. Behind canWrite
    * (controllers/roadmap.js), so it takes JSON from a signed-in person or a
    * Bearer caller, and records who.
    */
   update: function (req, res) {
      if (!projectSettings()) {
         return res.status(404).json({ error: 'projects are not set up in config.js' });
      }
      const body = req.body || {};
      if (!Object.prototype.hasOwnProperty.call(body, 'developer_teams')) {
         return res.status(400).json({ error: 'send developer_teams: an object of team name to logins, or null' });
      }
      const checked = checkDeveloperTeams(body.developer_teams);
      if (checked.error) return res.status(400).json({ error: checked.error });
      saveSetting('developer_teams', checked.teams, req.roadmapLogin)
         .then(() => res.json(current()))
         .catch(err => {
            console.error('settings save failed:', err);
            res.status(500).json({ error: 'settings save failed' });
         });
   },
};
