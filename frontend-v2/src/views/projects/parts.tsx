import type { ReactNode } from 'react';
import { issueUrl, n, shortRepo } from '../../../../shared/format';
import {
   projectName,
   type Project,
   type ProjectFlag,
   type ProjectGroup,
   type Today,
   type WindowCounts,
} from '../../../../shared/model/projects';
import { Avatar } from '../../components/identity';
import { dayWords } from '../../model/projectData';

/** What the Projects tab keeps in the URL hash, beside the lens. */
export interface ProjectsNav {
   view: 'overview' | 'roadmap' | 'people';
   /** a project's slug when its page is open */
   project: string | null;
   /** the date range's preset or custom key (model/projectData.ts) */
   range: string;
   /** which projects the list and timeline show (model/portfolio.ts STATUS_FILTERS) */
   status: string;
   /** how the list splits: none, parent, lead, or team */
   group: string;
   /** the list's sort column, `-` in front to reverse it */
   sort: string;
   /** the list's find box */
   find: string;
   /** the roadmap's layout: month or quarter columns, or now, next and later */
   scale: 'month' | 'quarter' | 'now';
   /** the roadmap item whose editor and updates are open */
   item: number | null;
   /** how the overview splits the merged work: by project, or roadmap or not */
   split: 'project' | 'roadmap';
   /** what the roadmap's timeline shows: everything in flight, only the
    * plans, or only the projects in flight with no plan */
   show: 'all' | 'plan' | 'unplanned';
   /** a week picked on the load chart (its Monday): the rows narrow to what
    * was in flight or planned then */
   week: string | null;
   /** the quarter or month the timeline is zoomed into, "2026-Q4" or
    * "2026-10" (model/roadmapTime.ts); null for the whole view */
   zoom: string | null;
}
export type Navigate = (patch: Partial<ProjectsNav>) => void;

/**
 * The way to one roadmap item from anywhere in the tab: the roadmap with the
 * item open, on a timeline even when it was showing now, next and later,
 * since the item's editor lives on the timeline.
 */
export function openPlan(nav: ProjectsNav, id: number): Partial<ProjectsNav> {
   return {
      project: null,
      view: 'roadmap',
      item: id,
      scale: nav.scale === 'now' ? 'quarter' : nav.scale,
   };
}

/** How many other live projects `login` has work in, for the lead flag's words. */
function otherLiveProjects(login: string, g: ProjectGroup, today: Today): number {
   return today.live.filter(o => o !== g && o.people.includes(login)).length;
}

/** Each flag in words, with the sentence its hover gives. Flags appear only
 * when true, and read as amber text: someone owes the project something. */
function flagText(flag: ProjectFlag, g: ProjectGroup, today: Today): [string, string] {
   switch (flag) {
      case 'one_person':
         return [
            'one person',
            `Every PR here, open or merged in the last 14 days, is by ${g.people[0]}.`,
         ];
      case 'waiting_on_review':
         return [
            'all waiting on review',
            'Every open PR here needs a CR or QA before it can move.',
         ];
      case 'lead_spread': {
         const lead = g.project?.lead ?? '';
         const others = otherLiveProjects(lead, g, today);
         return [
            `lead in ${n(others, 'other project')}`,
            `${lead} leads this and has PRs in ${n(others, 'other live project')}.`,
         ];
      }
      case 'issue_closed':
         return [
            'issue closed, PR still open',
            'The project’s issue is closed, but a PR labeled for it is still open.',
         ];
   }
}

export function FlagWords({ g, today }: { g: ProjectGroup; today: Today }) {
   if (!g.flags.length) return null;
   return (
      <>
         {g.flags.map(flag => {
            const [word, gloss] = flagText(flag, g, today);
            return (
               <span key={flag} className="whitespace-nowrap text-warn" title={gloss}>
                  {word}
               </span>
            );
         })}
      </>
   );
}

/** Up to three faces, then "+N": who is on a project, without a people table. */
export function PeopleStack({ logins, size = 16 }: { logins: string[]; size?: number }) {
   const shown = logins.slice(0, 3);
   const more = logins.length - shown.length;
   return (
      <span className="inline-flex flex-none items-center gap-1" title={logins.join(', ')}>
         <span className="inline-flex -space-x-1">
            {shown.map(login => (
               <Avatar key={login} login={login} size={size} />
            ))}
         </span>
         {more > 0 && <span className="text-[11px] text-ink-3 tabular-nums">+{more}</span>}
      </span>
   );
}

/** "Oct 31", or the milestone's title when it has no due date. */
function targetWords(target: NonNullable<Project['target']>): string {
   if (!target.due_on) return target.title;
   const due = dayWords(target.due_on);
   return target.title === due ? due : `${target.title}, due ${due}`;
}

/**
 * The facts a project's issue gives it, on one quiet line: the issue link,
 * lead, target, parents, and whether it has an end. Editing any of them means
 * editing the issue on GitHub, so every fact here is read-only.
 */
export function ProjectFacts({
   g,
   project,
   hasRepo,
   children,
}: {
   g: Pick<ProjectGroup, 'slug'>;
   project: Project | null;
   /** a projects repo is configured, so a missing issue is worth saying */
   hasRepo: boolean;
   /** trailing controls, e.g. the project page link */
   children?: ReactNode;
}) {
   const facts: ReactNode[] = [];
   if (project) {
      facts.push(
         <a
            key="issue"
            href={issueUrl(project.repo, project.number)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-brand hover:underline"
            title="Edit the name, lead, target or parents on the issue"
         >
            {shortRepo(project.repo)} #{project.number}
         </a>
      );
      if (project.lead) {
         facts.push(
            <span key="lead">
               Lead <span className="font-medium text-ink-2">{project.lead}</span>
            </span>
         );
      }
      if (project.target)
         facts.push(<span key="target">Target {targetWords(project.target)}</span>);
      if (project.parents.length) {
         facts.push(<span key="parents">Part of {project.parents.join(', ')}</span>);
      }
      facts.push(<span key="kind">{project.ongoing ? 'Ongoing' : 'Has an end'}</span>);
   } else if (hasRepo) {
      facts.push(
         <span key="none" title={`PRs carry the ${g.slug} label, but no project issue has it yet`}>
            No project issue yet
         </span>
      );
   }
   return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-xs text-ink-3">
         {facts}
         {children && <span className="ml-auto flex items-center gap-3">{children}</span>}
      </div>
   );
}

/** The link from a project's band or row to its own page. */
export function PageLink({ g, navigate }: { g: Pick<ProjectGroup, 'slug'>; navigate: Navigate }) {
   return (
      <button
         type="button"
         onClick={() => navigate({ project: g.slug })}
         className="hit pressable rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
      >
         Project page
      </button>
   );
}

/** An open project with nothing in flight: the name (its page's door), its
 * kind, and its lead. No rows to fold, so it's a plain line. */
export function QuietRow({ g, navigate }: { g: ProjectGroup; navigate: Navigate }) {
   return (
      <div className="flex items-center gap-3 border-t border-secondary px-3.5 py-2 text-[13px] first:border-t-0">
         <button
            type="button"
            onClick={() => navigate({ project: g.slug })}
            className="hit pressable min-w-0 truncate rounded border-0 bg-transparent p-0 text-left font-medium text-ink hover:text-brand"
         >
            {projectName(g)}
         </button>
         <span className="text-xs text-ink-3">{g.project?.ongoing ? 'ongoing' : 'has an end'}</span>
         <span className="ml-auto flex items-center gap-2 text-xs text-ink-3">
            {g.project?.lead && <PeopleStack logins={[g.project.lead]} />}
         </span>
      </div>
   );
}

/** One number with its label under it, the Stats tab's big-number style,
 * and an optional quiet line comparing it with the period before. */
export function Tile({
   value,
   label,
   title,
   note,
   onClick,
}: {
   value: ReactNode;
   label: string;
   title: string;
   note?: string | null;
   /** where the number comes from: a tile with a place to go is a button */
   onClick?: () => void;
}) {
   const body = (
      <>
         <div
            className={`text-xl font-semibold tabular-nums ${
               onClick ? 'text-ink group-hover:text-brand' : 'text-ink'
            }`}
         >
            {value}
         </div>
         <div className={`text-xs text-ink-3 ${onClick ? 'group-hover:underline' : ''}`}>
            {label}
         </div>
         {note && <div className="mt-0.5 text-[11px] text-ink-3 tabular-nums">{note}</div>}
      </>
   );
   return onClick ? (
      <button
         type="button"
         onClick={onClick}
         title={title}
         className="group pressable rounded border-0 bg-transparent p-0 text-left"
      >
         {body}
      </button>
   ) : (
      <div title={title}>{body}</div>
   );
}

const days = (d: number | null) => (d == null ? 'none' : `${d}`);

/** "4 more than the 30 days before", or null while there's nothing to compare. */
export function versus(
   now: number,
   before: number | null | undefined,
   period: string
): string | null {
   if (before == null) return null;
   const d = now - before;
   if (d === 0) return `same as the ${period}`;
   return `${Math.abs(d)} ${d > 0 ? 'more' : 'fewer'} than the ${period}`;
}

/** "1.5 days quicker than the 30 days before", for a median time. */
export function versusDays(
   now: number | null,
   before: number | null | undefined,
   period: string
): string | null {
   if (now == null || before == null) return null;
   const d = Math.round((now - before) * 10) / 10;
   if (d === 0) return `same as the ${period}`;
   return `${Math.abs(d)} days ${d < 0 ? 'quicker' : 'slower'} than the ${period}`;
}

/**
 * A window's numbers as tiles. The median age is there on purpose: over a
 * month the backlog can shrink while the PRs left in it get older, and the
 * count alone hides that. With `prev` (the same number of days just before),
 * each count says how it compares, in words: more is not always better, so
 * no color.
 */
export function WindowTiles({
   w,
   prev,
   period,
}: {
   w: WindowCounts;
   prev?: WindowCounts | null;
   /** what `prev` covers, e.g. "30 days before" */
   period?: string;
}) {
   const vs = (key: 'opened' | 'merged' | 'closed') =>
      prev && period ? versus(w[key], prev[key], period) : null;
   return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:grid-cols-7">
         <Tile
            value={`${w.backlog_start} to ${w.backlog_end}`}
            label="Open PRs, start to end"
            title="PRs open when the first day began, and when the last day ended"
         />
         <Tile
            value={w.opened}
            label="Opened"
            title="PRs opened during the range"
            note={vs('opened')}
         />
         <Tile
            value={w.merged}
            label="Merged"
            title="PRs merged during the range"
            note={vs('merged')}
         />
         <Tile
            value={w.closed}
            label="Closed without merging"
            title="PRs closed during the range without a merge"
            note={vs('closed')}
         />
         <Tile
            value={`${days(w.median_age_start_days)} to ${days(w.median_age_end_days)}`}
            label="Median age in days"
            title="Median age of the open PRs at the start and at the end"
         />
         <Tile
            value={days(w.median_days_to_merge)}
            label="Median days to merge"
            title="Median days from opened to merged, over the PRs merged in the range"
            note={
               period
                  ? versusDays(w.median_days_to_merge, prev?.median_days_to_merge, period)
                  : null
            }
         />
         <Tile
            value={`${w.developers} · ${w.non_developers}`}
            label="Developers · others"
            title="People with a PR in the range: on a developer team, and everyone else"
         />
      </div>
   );
}
