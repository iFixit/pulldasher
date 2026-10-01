import { projectSettings } from '../lib/projects.js';
import { saveSetting } from '../lib/settings.js';
import {
   checkDecideRotation,
   checkDeveloperTeams,
   checkOngoingProjects,
   mondayOf,
   utcDay,
} from '../shared/dist/index.js';

/** The settings as a reply: each value, and where the teams come from. */
function current() {
   const settings = projectSettings();
   return {
      developer_teams: settings.teams,
      decide_rotation: settings.decideRotation,
      ongoing_projects: settings.ongoing,
      from: { developer_teams: settings.teamsFrom },
   };
}

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);

// changes to the ongoing list run one at a time, each on the list the last
// one saved, so two quick clicks can't drop each other's project
let ongoingSaves = Promise.resolve();
function changeOngoing(change) {
   const next = ongoingSaves.then(change);
   ongoingSaves = next.catch(() => {});
   return next;
}

/** Mark one project ongoing, or take it back, on the saved list. */
function markOngoing(slug, ongoing, login) {
   return changeOngoing(() => {
      const rest = projectSettings().ongoing.filter(s => s !== slug);
      const list = ongoing ? [...rest, slug].sort() : rest;
      return saveSetting('ongoing_projects', list.length ? list : null, login);
   });
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
    * PATCH /settings and /api/v1/settings {developer_teams?, decide_rotation?,
    * ongoing_projects?, ongoing_project?} -- replace the developer teams
    * (null goes back to config.js's), who takes turns running Decide,
    * starting with the first this week (null for nobody), or the projects
    * marked ongoing; or mark one project ongoing or not with
    * ongoing_project {slug, ongoing}. Behind canWrite (controllers/roadmap.js),
    * so it takes JSON from a signed-in person or a Bearer caller, and records
    * who.
    */
   update: function (req, res) {
      if (!projectSettings()) {
         return res.status(404).json({ error: 'projects are not set up in config.js' });
      }
      const body = req.body || {};
      if (
         !has(body, 'developer_teams') &&
         !has(body, 'decide_rotation') &&
         !has(body, 'ongoing_projects') &&
         !has(body, 'ongoing_project')
      ) {
         return res.status(400).json({
            error:
               'send developer_teams (an object of team name to logins, or null), ' +
               'decide_rotation (a list of logins, or null), ongoing_projects (a list of ' +
               'project slugs, or null) or ongoing_project ({slug, ongoing})',
         });
      }
      const saves = [];
      if (has(body, 'ongoing_project')) {
         const { slug, ongoing } = body.ongoing_project ?? {};
         const checked = checkOngoingProjects([slug]);
         if (checked.error || typeof ongoing !== 'boolean') {
            return res.status(400).json({
               error: 'send ongoing_project as {slug, ongoing}: a project slug and true or false',
            });
         }
         saves.push(() => markOngoing(checked.slugs[0], ongoing, req.roadmapLogin));
      }
      if (has(body, 'developer_teams')) {
         const checked = checkDeveloperTeams(body.developer_teams);
         if (checked.error) return res.status(400).json({ error: checked.error });
         saves.push(() => saveSetting('developer_teams', checked.teams, req.roadmapLogin));
      }
      if (has(body, 'ongoing_projects')) {
         const checked = checkOngoingProjects(body.ongoing_projects);
         if (checked.error) return res.status(400).json({ error: checked.error });
         const list = checked.slugs && checked.slugs.length ? checked.slugs : null;
         saves.push(() =>
            changeOngoing(() => saveSetting('ongoing_projects', list, req.roadmapLogin))
         );
      }
      if (has(body, 'decide_rotation')) {
         const checked = checkDecideRotation(body.decide_rotation);
         if (checked.error) return res.status(400).json({ error: checked.error });
         const from = mondayOf(utcDay(Date.now() / 1000));
         const rotation = checked.logins && { logins: checked.logins, from };
         saves.push(() => saveSetting('decide_rotation', rotation, req.roadmapLogin));
      }
      saves
         .reduce((done, save) => done.then(save), Promise.resolve())
         .then(() => res.json(current()))
         .catch(err => {
            console.error('settings save failed:', err);
            res.status(500).json({ error: 'settings save failed' });
         });
   },
};
