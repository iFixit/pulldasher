import config from './config-loader.js';
import db from './db.js';
import { deriveAll, isBot, toWire } from './review-model.js';
import {
   buildToday,
   dayStart,
   projectOf,
   projectSlugs,
   utcDay,
   DEFAULT_PROJECT_PREFIX,
   ONGOING_LABEL,
   PARENT_PREFIX,
} from '../shared/dist/index.js';

/**
 * The server half of Projects (the model itself is shared/model/projects.ts):
 * reads project issues and PR history out of the tables Pulldasher already
 * keeps, and builds Today from the live board. Nothing here writes to GitHub;
 * the job that labels PRs and opens project issues runs outside Pulldasher.
 */

const DAY = 86400;
/** the longest window a request may ask for, which bounds the history scan */
export const MAX_WINDOW_DAYS = 400;
/** the window when a request names no start: 30 days ending on `end` */
export const DEFAULT_WINDOW_DAYS = 30;

/**
 * This install's projects config, or null when it doesn't use projects (the
 * board then hides the tab). `repo` may be null too: PRs still group by
 * their labels, just without the names, leads and targets an issue gives.
 * `teams` is the configured developerTeams object (`{}` when absent); `teamOf`
 * looks a login up in it case-insensitively, returning null for anyone not
 * listed (which windowStats treats as a non-developer).
 */
export function projectSettings() {
   if (!config.projects) return null;
   const teams = config.projects.developerTeams || {};
   const byLogin = new Map();
   for (const [team, logins] of Object.entries(teams)) {
      for (const login of logins) byLogin.set(login.toLowerCase(), team);
   }
   return {
      repo: config.projects.repo || null,
      prefix: config.projects.labelPrefix || DEFAULT_PROJECT_PREFIX,
      teams,
      teamOf: login => byLogin.get(login.toLowerCase()) ?? null,
   };
}

/**
 * Every project issue, open and closed, from the issues table plus the labels
 * Pulldasher stores for issues in pull_labels (issue and PR numbers share one
 * space per repo, so the two can't collide).
 */
export async function loadProjects(settings) {
   if (!settings || !settings.repo) return [];
   const [issues, labels] = await Promise.all([
      db.query('SELECT * FROM issues WHERE repo = ?', [settings.repo]),
      db.query('SELECT number, title FROM pull_labels WHERE repo = ?', [settings.repo]),
   ]);
   return projectsFromRows(issues, labels, settings.prefix);
}

/**
 * Issue rows + label rows -> Projects. An issue without a project label isn't
 * a project and is skipped. Two issues carrying one label shouldn't happen;
 * if it does, the open one wins, then the newer.
 */
export function projectsFromRows(issues, labelRows, prefix) {
   const titles = new Map();
   for (const { number, title } of labelRows) {
      if (!titles.has(number)) titles.set(number, []);
      titles.get(number).push(title);
   }
   const bySlug = new Map();
   for (const issue of issues) {
      const names = titles.get(issue.number) || [];
      const slug = projectSlugs(names.map(title => ({ title })), prefix)[0];
      if (!slug) continue;
      const project = {
         slug,
         name: issue.title || slug,
         repo: issue.repo,
         number: issue.number,
         state: issue.status === 'closed' ? 'closed' : 'open',
         state_reason: issue.state_reason || null,
         ongoing: names.includes(ONGOING_LABEL),
         parents: names
            .filter(n => n.startsWith(PARENT_PREFIX) && n.length > PARENT_PREFIX.length)
            .map(n => n.slice(PARENT_PREFIX.length))
            .sort(),
         lead: issue.assignee || null,
         target: issue.milestone_title
            ? {
                 title: issue.milestone_title,
                 due_on: issue.milestone_due_on
                    ? new Date(issue.milestone_due_on * 1000).toISOString()
                    : null,
              }
            : null,
         created_at: issue.date_created != null
            ? new Date(issue.date_created * 1000).toISOString()
            : null,
         closed_at: issue.date_closed != null
            ? new Date(issue.date_closed * 1000).toISOString()
            : null,
      };
      const prev = bySlug.get(slug);
      const openFirst = prev && (project.state === 'open') - (prev.state === 'open');
      if (!prev || openFirst > 0 || (openFirst === 0 && project.number > prev.number)) {
         bySlug.set(slug, project);
      }
   }
   return [...bySlug.values()];
}

const pullKey = (repo, number) => `${String(repo).toLowerCase()}#${number}`;

/** repo+number (case-insensitive on repo) -> its project slug, from
 * project-label rows. One lookup shared by spansFromRows and the review
 * narrowing in loadWindow, so a PR's project can never disagree between them. */
function pullProjects(labelRows, prefix) {
   const titles = new Map();
   for (const { repo, number, title } of labelRows) {
      const k = pullKey(repo, number);
      if (!titles.has(k)) titles.set(k, []);
      titles.get(k).push({ title });
   }
   return (repo, number) => projectOf(titles.get(pullKey(repo, number)) || [], prefix);
}

/** pulls rows + project-label rows -> PullSpans, bots left out. */
export function spansFromRows(pulls, labelRows, prefix) {
   const projectOfPull = pullProjects(labelRows, prefix);
   return pulls
      .filter(p => p.date != null && !isBot(p.owner))
      .map(p => {
         // a merged pull always has a close time, but take the merge time if a
         // row ever lacks one rather than counting it open forever
         const closed = p.date_closed ?? p.date_merged ?? null;
         return {
            author: p.owner,
            project: projectOfPull(p.repo, p.number),
            opened: Number(p.date),
            closed: closed == null ? null : Number(closed),
            merged: p.date_merged != null,
         };
      });
}

/** pull_signatures rows (joined to pulls for the author) -> ReviewSpans,
 * dropping a stamp given by a bot or given on a bot's PR. Carries repo and
 * number too, past what ReviewSpan itself needs, so a caller can narrow the
 * stamps to one project the same way spansFromRows does for pulls. */
export function reviewsFromRows(rows) {
   return rows
      .filter(r => !isBot(r.reviewer) && !isBot(r.author))
      .map(({ reviewer, author, at, repo, number }) => ({
         reviewer,
         author,
         at: Number(at),
         repo,
         number,
      }));
}

/**
 * People's PRs and the CR/QA stamps given on them, in the tracked repos,
 * touching the UTC days start..end, as { spans, reviews }. With a `project`
 * slug, both are narrowed to that project's PRs (spans by their own .project,
 * reviews by looking their repo+number up in the same label rows). Three
 * plain queries, joined here rather than in SQL.
 */
export async function loadWindow(settings, start, end, project) {
   const from = dayStart(start);
   const to = dayStart(end) + DAY;
   const repos = config.repos.map(r => r.name);
   const [pulls, labels, reviewRows] = await Promise.all([
      db.query(
         'SELECT repo, number, owner, date, date_closed, date_merged FROM pulls ' +
            'WHERE repo IN (?) AND date < ? AND (date_closed IS NULL OR date_closed >= ?)',
         [repos, to, from]
      ),
      db.query('SELECT repo, number, title FROM pull_labels WHERE title LIKE ?', [
         // LIKE's own wildcards in a prefix must match literally
         settings.prefix.replace(/[\\%_]/g, '\\$&') + '%',
      ]),
      db.query(
         'SELECT s.user AS reviewer, s.repo, s.number, p.owner AS author, s.date AS at ' +
            'FROM pull_signatures s JOIN pulls p ON p.repo = s.repo AND p.number = s.number ' +
            "WHERE s.type IN ('CR', 'QA') AND s.date >= ? AND s.date < ? AND p.repo IN (?)",
         [from, to, repos]
      ),
   ]);
   const spans = spansFromRows(pulls, labels, settings.prefix);
   const reviews = reviewsFromRows(reviewRows);
   if (project == null) return { spans, reviews };
   const projectOfPull = pullProjects(labels, settings.prefix);
   return {
      spans: spans.filter(s => s.project === project),
      reviews: reviews.filter(r => projectOfPull(r.repo, r.number) === project),
   };
}

/**
 * The window a request asks for: `start` and `end` as YYYY-MM-DD UTC days,
 * both counted. end defaults to today, start to 29 days before end. Returns
 * { start, end } or { error } with a message fit for a 400.
 */
export function parseWindow(query, now = Date.now() / 1000) {
   for (const name of ['start', 'end']) {
      if (query[name] !== undefined && typeof query[name] !== 'string') {
         return { error: `${name} must be one YYYY-MM-DD day` };
      }
   }
   const end = query.end || utcDay(now);
   const endAt = dayStart(end);
   if (endAt == null) return { error: 'end must be a YYYY-MM-DD day' };
   const start = query.start || utcDay(endAt - (DEFAULT_WINDOW_DAYS - 1) * DAY);
   const startAt = dayStart(start);
   if (startAt == null) return { error: 'start must be a YYYY-MM-DD day' };
   if (startAt > endAt) return { error: 'start must not be after end' };
   if ((endAt - startAt) / DAY + 1 > MAX_WINDOW_DAYS) {
      return { error: `a window can span at most ${MAX_WINDOW_DAYS} days` };
   }
   return { start, end };
}

/**
 * Today from the live board: the same open + recently closed pulls the socket
 * ships (Pull models), people's only, run through the shared buildToday.
 */
export function todayFromBoard(pulls, projects, prefix, now = Date.now() / 1000) {
   const people = pulls.filter(p => !isBot(p.data.user.login));
   const open = deriveAll(people.filter(p => p.isOpen()), now);
   const closed = people.filter(p => !p.isOpen()).map(toWire);
   return buildToday(projects, open, closed, prefix, now);
}
