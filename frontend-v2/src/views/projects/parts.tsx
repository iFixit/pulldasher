import type { ReactNode } from 'react';
import { issueUrl, shortRepo } from '../../../../shared/format';
import {
   ONE_PERSON_MIN_PRS,
   targetOf,
   type Project,
   type ProjectFlag,
   type ProjectGroup,
   type ProjectTarget,
   type WindowCounts,
} from '../../../../shared/model/projects';
import { ORIGIN_WORD, ROADMAP_ORIGINS, type RoadmapOrigin } from '../../../../shared/model/roadmap';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/identity';
import { eyebrowText } from '../../components/Lane';
import { dayWords } from '../../model/projectData';

/** What the Projects tab keeps in the URL hash, beside the lens. */
export interface ProjectsNav {
   view: 'overview' | 'decide' | 'roadmap' | 'people' | 'retro';
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
   /** what the roadmap's timeline shows: everything in flight, only the
    * plans, or only the projects in flight with no plan */
   show: 'all' | 'plan' | 'unplanned';
   /** a week picked on the load chart (its Monday): the rows narrow to what
    * was in flight or planned then */
   week: string | null;
   /** the quarter or month the timeline is zoomed into, "2026-Q4" or
    * "2026-10" (model/roadmapTime.ts); null for the whole view */
   zoom: string | null;
   /** Decide's team: only its rows show; null for every team */
   team: string | null;
   /** where the work came from, picked on the load chart: the timeline
    * shows only the plans from there; null for every plan */
   origin: RoadmapOrigin | 'unsaid' | null;
   /** how Look back's last list splits the days, beside its people and
    * project tables */
   by: 'team' | 'origin' | 'author' | 'repo';
   /** which of Look back's days count: all, only writing, or only reviewing */
   kind: 'all' | 'writing' | 'reviewing';
   /** a person picked in Look back: only their days count */
   who: string | null;
   /** what a tile or a chart's bar narrowed the project list to
    * (model/portfolio.ts matchesOnly); null for nothing */
   only: string | null;
   /** the people table's sort column, `-` in front to reverse it; empty
    * for the view's own default */
   psort: string;
}
/** Change the tab's view. A change of view (lens, project, view, zoom) gets
 * a history entry so Back undoes it; `push` asks for one for any other
 * change a click made (typing replaces the entry instead). */
export type Navigate = (patch: Partial<ProjectsNav>, opts?: { push?: boolean }) => void;

/** Where the work came from, as a switch's options; `unsaid` stands for a
 * plan nobody has said it about. */
export const ORIGIN_OPTIONS: [RoadmapOrigin | 'unsaid', string][] = [
   ...ROADMAP_ORIGINS.map((o): [RoadmapOrigin, string] => [o, ORIGIN_WORD[o]]),
   ['unsaid', 'Not said'],
];

/**
 * The way to one roadmap item from anywhere in the tab: the roadmap with the
 * item open, on a timeline even when it was showing now, next and later,
 * since the item's editor lives on the timeline. The find box, a picked
 * week, the show switch and a picked origin are cleared, since any of them
 * could hide it.
 */
export function openPlan(nav: ProjectsNav, id: number): Partial<ProjectsNav> {
   return {
      project: null,
      view: 'roadmap',
      item: id,
      scale: nav.scale === 'now' ? 'quarter' : nav.scale,
      find: '',
      week: null,
      show: 'all',
      origin: null,
   };
}

/** Each flag in words, with the sentence its hover gives. Flags appear only
 * when true, and read as amber text: someone owes the project something. */
function flagText(flag: ProjectFlag, g: ProjectGroup): [string, string] {
   switch (flag) {
      case 'one_person':
         return [
            'only one person',
            `${ONE_PERSON_MIN_PRS} or more PRs here, open or merged in the last 14 days, and every one is by ${g.people[0]}.`,
         ];
      case 'waiting_on_review':
         return [
            'all waiting on review',
            'All of its open PRs (2 or more) are waiting on a CR or QA.',
         ];
      case 'issue_closed':
         return [
            'issue closed, PR still open',
            'The project’s issue is closed, but a PR labeled for it is still open.',
         ];
   }
}

export function FlagWords({ g }: { g: ProjectGroup }) {
   if (!g.flags.length) return null;
   return (
      <>
         {g.flags.map(flag => {
            const [word, gloss] = flagText(flag, g);
            return (
               <span key={flag} className="whitespace-nowrap text-warn" title={gloss}>
                  {word}
               </span>
            );
         })}
      </>
   );
}

/** Up to three faces, then "+N": who is on a project, without a people
 * table. With `onPerson`, a face opens that person's PRs. */
export function PeopleStack({
   logins,
   size = 16,
   onPerson,
}: {
   logins: string[];
   size?: number;
   onPerson?: (login: string) => void;
}) {
   const shown = logins.slice(0, 3);
   const more = logins.length - shown.length;
   return (
      <span className="inline-flex flex-none items-center gap-1" title={logins.join(', ')}>
         <span className="inline-flex -space-x-1">
            {shown.map(login => (
               <Avatar key={login} login={login} size={size} onClick={onPerson} />
            ))}
         </span>
         {more > 0 && <span className="text-[11px] text-ink-3 tabular-nums">+{more}</span>}
      </span>
   );
}

/** "Oct 31", or the milestone's title when it has no due date. */
function targetWords(target: ProjectTarget): string {
   if (!target.due_on) return target.title ?? '';
   const due = dayWords(target.due_on);
   return !target.title || target.title === due ? due : `${target.title}, due ${due}`;
}

/** Where a facts line's words go: the lead, and the other projects. */
export interface FactLinks {
   navigate: Navigate;
   /** a project's name by slug; null when no project issue has that slug */
   nameOf: (slug: string) => string | null;
   /** the projects that name this one as their parent */
   parts: { slug: string; name: string }[];
}

/** A word in a facts line that goes somewhere when clicked. */
function FactLink({
   onClick,
   title,
   children,
}: {
   onClick: () => void;
   title: string;
   children: ReactNode;
}) {
   return (
      <button
         type="button"
         onClick={onClick}
         title={title}
         className="hit pressable rounded border-0 bg-transparent p-0 font-medium text-ink-2 hover:text-brand hover:underline"
      >
         {children}
      </button>
   );
}

/**
 * The facts a project's issue gives it, on one quiet line: the issue link,
 * lead, target, the projects it's part of (and, on a parent, the ones that
 * are part of it), and whether it has an end. Editing the issue's facts
 * means editing the issue on GitHub; with `links`, the lead and the other
 * projects go to their pages here.
 */
export function ProjectFacts({
   g,
   project,
   prefix,
   ongoing,
   links,
   onOngoing,
   ongoingByLabel = false,
   children,
}: {
   g: Pick<ProjectGroup, 'slug'>;
   project: Project | null;
   /** the project label prefix, to name the label in full */
   prefix: string;
   /** marked ongoing on the board or by its issue's label; the label alone
    * when not given */
   ongoing?: boolean;
   /** where the lead and the other projects go; without it they're words */
   links?: FactLinks;
   /** set whether it runs with no end; without it the line only says so */
   onOngoing?: (ongoing: boolean) => void;
   /** its issue's label says it's ongoing, so only the label can change it */
   ongoingByLabel?: boolean;
   /** trailing controls, e.g. the project page link */
   children?: ReactNode;
}) {
   const go = links?.navigate;
   // a parent that's a project opens its page; a parent that's only a label
   // opens the list split by parent, where its projects sit together
   const parentLink = (parent: string) => {
      const name = links?.nameOf(parent);
      return (
         <FactLink
            key={parent}
            onClick={() =>
               name
                  ? go?.({ project: parent })
                  : go?.({
                       project: null,
                       view: 'overview',
                       status: 'all',
                       group: 'parent',
                       find: parent,
                    })
            }
            title={name ? `Open ${name}` : `The projects that are part of ${parent}`}
         >
            {name ?? parent}
         </FactLink>
      );
   };
   const list = (nodes: ReactNode[]) =>
      nodes.flatMap((node, i) => (i ? [<span key={`and${i}`}>, </span>, node] : [node]));
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
         const lead = project.lead;
         facts.push(
            <span key="lead">
               Lead{' '}
               {go ? (
                  <FactLink
                     onClick={() => go({ project: null, view: 'overview', find: lead })}
                     title={`Find the projects ${lead} is on`}
                  >
                     {lead}
                  </FactLink>
               ) : (
                  <span className="font-medium text-ink-2">{lead}</span>
               )}
            </span>
         );
      }
      const target = targetOf(project);
      if (target) facts.push(<span key="target">Target {targetWords(target)}</span>);
      if (project.fields.start) {
         facts.push(<span key="start">Starts {dayWords(project.fields.start)}</span>);
      }
      if (project.fields.priority) {
         facts.push(<span key="priority">Priority {project.fields.priority}</span>);
      }
      if (project.parents.length) {
         facts.push(
            <span key="parents">
               Part of {go ? list(project.parents.map(parentLink)) : project.parents.join(', ')}
            </span>
         );
      }
   } else {
      facts.push(
         <span
            key="none"
            title={`PRs carry the ${prefix}${g.slug} label, but no issue has it yet. Give one issue in any tracked repo the same label to name the project and set its lead.`}
         >
            No project issue yet
         </span>
      );
   }
   if (go && links.parts.length) {
      facts.push(
         <span key="parts">
            Parent of{' '}
            {list(
               links.parts.map(p => (
                  <FactLink
                     key={p.slug}
                     onClick={() => go({ project: p.slug })}
                     title={`Open ${p.name}`}
                  >
                     {p.name}
                  </FactLink>
               ))
            )}
         </span>
      );
   }
   const isOngoing = ongoing ?? !!project?.ongoing;
   if (onOngoing) {
      facts.push(
         <label
            key="kind"
            className="inline-flex cursor-pointer items-center gap-1.5 has-[:disabled]:cursor-default"
            title={
               ongoingByLabel
                  ? 'Its issue’s ongoing label says so; take the label off to change it'
                  : 'Decide stops asking it for a first plan, a finished plan of its stays finished as the work goes on, and its page skips the finish forecast'
            }
         >
            <input
               type="checkbox"
               checked={isOngoing}
               disabled={ongoingByLabel}
               onChange={e => onOngoing(e.target.checked)}
               className="m-0 disabled:opacity-40"
            />
            Ongoing, no end
         </label>
      );
   } else if (project) {
      facts.push(<span key="kind">{isOngoing ? 'Ongoing' : 'Has an end'}</span>);
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

/** One number with its label under it, the Stats tab's big-number style,
 * and an optional quiet line comparing it with the period before. */
export function Tile({
   value,
   label,
   title,
   note,
   onClick,
   warn = false,
}: {
   value: ReactNode;
   label: string;
   title: string;
   note?: string | null;
   /** where the number comes from: a tile with a place to go is a button */
   onClick?: () => void;
   /** amber: someone owes what it counts */
   warn?: boolean;
}) {
   const body = (
      <>
         <div
            className={`text-xl font-semibold tabular-nums ${
               warn ? 'text-warn' : onClick ? 'text-ink group-hover:text-brand' : 'text-ink'
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

/** Parse a sort param against a table's columns: a column key, `-` in
 * front to reverse it; anything else is the table's default. */
export function readSort<K extends string>(
   raw: string,
   keys: readonly K[],
   fallback: K
): { key: K; reversed: boolean } {
   const reversed = raw.startsWith('-');
   const key = (reversed ? raw.slice(1) : raw) as K;
   return keys.includes(key) ? { key, reversed } : { key: fallback, reversed: false };
}

/** A column header that sorts its table by that column; a second click
 * reverses it. `sort` is what the table sorts by now. */
export function SortHeader<K extends string>({
   label,
   title,
   sortKey,
   sort,
   onSort,
   className = '',
}: {
   label: string;
   title: string;
   sortKey: K;
   sort: { key: K; reversed: boolean };
   /** the new sort param: the key, `-` in front to reverse */
   onSort: (param: string) => void;
   className?: string;
}) {
   const active = sort.key === sortKey;
   // the cell carries the column's width and hiding; the button only its words
   return (
      <span
         className={className}
         aria-sort={active ? (sort.reversed ? 'ascending' : 'descending') : undefined}
      >
         <button
            type="button"
            title={title}
            onClick={() => onSort(active && !sort.reversed ? `-${sortKey}` : sortKey)}
            className={`pressable inline-flex items-center gap-1 rounded border-0 bg-transparent p-0 text-left whitespace-nowrap ${eyebrowText} ${
               active ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
            }`}
         >
            {label}
            {active && <Icon icon={sort.reversed ? ArrowUp : ArrowDown} size={12} />}
         </button>
      </span>
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
            label="Developers · non-developers"
            title="People with a PR in the range: on a developer team, and everyone else"
         />
      </div>
   );
}
