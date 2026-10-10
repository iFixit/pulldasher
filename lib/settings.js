import db from './db.js';

/**
 * The settings people change from the board or /api/v1/settings, kept in
 * `project_settings` as one JSON value per name. They're read on every
 * request (projectSettings in lib/projects.js reads the developer teams),
 * so they're held in memory: loaded at startup and again after each save.
 * One process serves the board, so the copy can't go stale.
 */
let saved = {};
// until a load succeeds, `saved` is empty and reads serve config.js's
// defaults; a save then would write those over what's really saved
let loaded = false;

export async function loadSettings() {
   const rows = await db.query('SELECT `name`, `value` FROM `project_settings`');
   saved = Object.fromEntries(rows.map(row => [row.name, JSON.parse(row.value)]));
   loaded = true;
}

export const settingsLoaded = () => loaded;

/** Load at startup, trying again with a growing wait until it works. */
export async function loadSettingsWithRetry(wait = 1000, max = 60000) {
   for (;;) {
      try {
         return await loadSettings();
      } catch (err) {
         console.error('loading saved settings failed, retrying in %ds:', wait / 1000, err);
         await new Promise(resolve => setTimeout(resolve, wait));
         wait = Math.min(wait * 2, max);
      }
   }
}

/** A saved setting's value, or null when nobody has saved one. */
export function savedSetting(name) {
   return saved[name] ?? null;
}

/** Save a setting, or with null drop it and go back to the default. */
export async function saveSetting(name, value, login, now = Math.floor(Date.now() / 1000)) {
   if (value == null) {
      await db.query('DELETE FROM `project_settings` WHERE `name` = ?', [name]);
   } else {
      await db.query('REPLACE INTO `project_settings` SET ?', [
         { name, value: JSON.stringify(value), updated_by: login, updated_at: now },
      ]);
   }
   await loadSettings();
}

/** test hook: forget what was loaded */
export function _resetSettings(isLoaded = true) {
   saved = {};
   loaded = isLoaded;
}
