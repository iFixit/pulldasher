import type { ReactNode } from 'react';
import { issueUrl, shortRepo } from '../../../../shared/format';
import {
   ONE_PERSON_MIN_PRS,
   targetOf,
   type Project,
   type ProjectFlag,
   type ProjectGroup,
   type ProjectTarget,
} from '../../../../shared/model/projects';
import { ORIGIN_WORD, ROADMAP_ORIGINS, type RoadmapOrigin } from '../../../../shared/model/roadmap';
import { ArrowDown, ArrowUp, ChevronRight, X } from 'lucide-react';
import { FactLink } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/identity';
import { eyebrowText } from '../../components/Lane';
import { DEFAULT_SORT } from '../../lens';
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
   /** a person picked: People opens their row; Look back counts only their days */
   who: string | null;
   /** what a tile or a chart's bar narrowed the project list to
    * (model/portfolio.ts matchesOnly); null for nothing */
   only: string | null;
   /** the people table's sort column, `-` in front to reverse it; empty
    * for the view's own default */
   psort: string;
}
/** Change the tab's view. A change of view (lens, project, view, zoom) or a
 * pick that narrows one (only, team, week, origin, item, Look back's person
 * and split) gets a history entry, so Back undoes it; `push` asks for one
 * for any other change a click made, such as a find a click sets (typing
 * replaces the entry instead). */
export type Navigate = (patch: Partial<ProjectsNav>, opts?: { push?: boolean }) => void;

/** Another view, opened the way the view switch opens it: the view's own
 * picks (a sort, a team, a person, a week, a narrowing) stay behind, so one
 * view never quietly narrows the next. */
export function switchView(view: ProjectsNav['view']): Partial<ProjectsNav> {
   return {
      view,
      project: null,
      item: null,
      // the list's own "nothing picked", so no empty sort= lands in the URL
      sort: DEFAULT_SORT,
      psort: '',
      team: null,
      who: null,
      only: null,
      week: null,
      origin: null,
      by: 'team',
      kind: 'all',
      // the list's Group by and the roadmap's lanes share this key, and the
      // roadmap's Show narrows its rows: neither carries into another view
      group: 'none',
      show: 'all',
   };
}

/** What narrows a list, as a chip beside its find box with its own way
 * out: the roadmap's picked week, a tile's or a bar's pick on the project
 * list. `clear` names what the × does. */
export function NarrowChip({
   label,
   clear,
   onClear,
}: {
   label: string;
   clear: string;
   onClear: () => void;
}) {
   return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-brand bg-surface py-1 pr-1 pl-2 text-xs text-ink">
         {label}
         <button
            type="button"
            aria-label={clear}
            title={clear}
            onClick={onClear}
            className="hit pressable rounded border-0 bg-transparent p-0 text-ink-3 hover:text-ink"
         >
            <Icon icon={X} size={12} />
         </button>
      </span>
   );
}

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

/** A project flag's words and the sentence behind them. */
export function flagText(flag: ProjectFlag, g: ProjectGroup): [string, string] {
   switch (flag) {
      case 'one_person':
         return [
            'only one person',
            `${ONE_PERSON_MIN_PRS} or more PRs here, open or merged in the last 14 days, and every one is by ${g.people[0]}.`,
         ];
      case 'waiting_on_review':
         return ['all waiting on review', 'All of its open PRs (2 or more) are waiting on review.'];
   }
}

/** Each flag in words, with the sentence its hover gives. Flags appear only
 * when true, in quiet ink: a row's one amber mark is its Plan cell. */
export function FlagWords({ g }: { g: ProjectGroup }) {
   if (!g.flags.length) return null;
   return (
      <>
         {g.flags.map(flag => {
            const [word, gloss] = flagText(flag, g);
            return (
               <span key={flag} className="whitespace-nowrap text-ink-3" title={gloss}>
                  {word}
               </span>
            );
         })}
      </>
   );
}

/** Up to three faces, then "+N": who is on a project, without a people
 * table. With `onPerson`, a face opens that person; with `me`, yours wears
 * your star. */
export function PeopleStack({
   logins,
   size = 16,
   onPerson,
   me,
}: {
   logins: string[];
   size?: number;
   onPerson?: (login: string) => void;
   /** the viewer's login */
   me?: string;
}) {
   const shown = logins.slice(0, 3);
   const more = logins.length - shown.length;
   return (
      <span className="inline-flex flex-none items-center gap-1" title={logins.join(', ')}>
         {/* side by side, not overlapped: each face's hit area reaches 4px
             past its edge, so overlapped faces gave the first face's middle
             to the second person */}
         <span className="inline-flex gap-1">
            {shown.map(login => (
               <Avatar
                  key={login}
                  login={login}
                  size={size}
                  onClick={onPerson}
                  you={!!me && login.toLowerCase() === me.toLowerCase()}
               />
            ))}
         </span>
         {more > 0 && <span className="text-[11px] text-ink-3 tabular-nums">+{more}</span>}
      </span>
   );
}

/** "Oct 31", or the milestone's title when it has no due date. */
export function targetWords(target: ProjectTarget): string {
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

/**
 * The facts a project's issue gives it, on one quiet line: the issue link,
 * lead, target, the projects it's part of (and, on a parent, the ones that
 * are part of it), and whether it runs with no end. Editing the issue's
 * facts means editing the issue on GitHub; with `links`, the lead opens
 * their row on People and the other projects their pages here.
 */
export function ProjectFacts({
   g,
   project,
   prefix,
   ongoing,
   links,
   onOngoing,
   ongoingByLabel = false,
   inline = false,
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
   /** a line of the page's own, not a row in a box; its dates go to the plan */
   inline?: boolean;
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
                  : go?.(
                       {
                          ...switchView('overview'),
                          status: 'all',
                          group: 'parent',
                          find: `parent:${parent}`,
                       },
                       { push: true }
                    )
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
                  // a person clicked anywhere in the tab opens their row on People
                  <FactLink
                     onClick={() => go({ ...switchView('people'), who: lead }, { push: true })}
                     title={`Open ${lead}’s row on People`}
                  >
                     {lead}
                  </FactLink>
               ) : (
                  <span className="font-medium text-ink-2">{lead}</span>
               )}
            </span>
         );
      }
      const target = inline ? null : targetOf(project);
      if (target) facts.push(<span key="target">Target {targetWords(target)}</span>);
      if (project.fields.start) {
         // the issue's own field, which can differ from its plan's dates on a
         // page that shows both, so it says where it comes from there
         facts.push(
            <span key="start">
               Starts {dayWords(project.fields.start)}
               {inline ? ' (on its issue)' : ''}
            </span>
         );
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
            No issue names it yet
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
   if (onOngoing && ongoingByLabel) {
      // only the label can change it, so words instead of a box that can't
      facts.push(
         <span key="kind" title="Take the ongoing label off its issue to change this">
            Ongoing, set by its issue’s label
         </span>
      );
   } else if (onOngoing) {
      facts.push(
         <label
            key="kind"
            className="inline-flex cursor-pointer items-center gap-1.5"
            title="Decide stops asking it for a first plan, a finished plan of its stays finished as the work goes on, and its page skips the finish forecast"
         >
            <input
               type="checkbox"
               checked={isOngoing}
               onChange={e => onOngoing(e.target.checked)}
               className="m-0"
            />
            Ongoing, no end
         </label>
      );
   } else if (isOngoing) {
      // having an end is the usual case, so only the exception is said
      facts.push(<span key="kind">Ongoing</span>);
   }
   return (
      <div
         className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3 ${
            inline ? '' : 'px-3.5 py-2'
         }`}
      >
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
 * and an optional quiet line under that. The number sits at the top
 * whatever its neighbors' notes run to. A tile should open what it counts:
 * with `onClick` it's a button and looks like one, its label in ink with a
 * chevron and the whole tile lit on hover. */
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
   /** what it counts, opened: a tile with a place to go is a button */
   onClick?: () => void;
   /** someone owes what it counts: its label is amber, its number never */
   warn?: boolean;
}) {
   const body = (
      <>
         <span className="text-xl font-semibold text-ink tabular-nums">{value}</span>
         {/* amber names what's owed, on the word: counts are never amber */}
         <span
            className={`inline-flex items-center gap-0.5 text-xs ${
               warn
                  ? 'text-warn group-hover:underline'
                  : onClick
                  ? 'text-ink-2 group-hover:text-brand group-hover:underline'
                  : 'text-ink-3'
            }`}
         >
            {label}
            {onClick && <Icon icon={ChevronRight} size={12} className="flex-none" />}
         </span>
         {note && <span className="mt-0.5 text-[11px] text-ink-3 tabular-nums">{note}</span>}
      </>
   );
   const box = 'flex flex-col items-start text-left';
   return onClick ? (
      <button
         type="button"
         onClick={onClick}
         title={title}
         // the padding lights a target on hover; the margin keeps the tiles
         // where they'd sit without it
         className={`group pressable -m-2 rounded-lg border-0 bg-transparent p-2 transition-[background-color] duration-150 ease-out hover:bg-muted motion-reduce:transition-none ${box}`}
      >
         {body}
      </button>
   ) : (
      <div title={title} className={box}>
         {body}
      </div>
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
 * reverses it. `sort` is what the table sorts by now. It's the header cell
 * itself (role columnheader, with aria-sort), so its row needs role row in
 * a role table. */
export function SortHeader<K extends string>({
   label,
   title,
   sortKey,
   sort,
   onSort,
   className = '',
   order = 'descending',
}: {
   label: string;
   title: string;
   sortKey: K;
   sort: { key: K; reversed: boolean };
   /** the new sort param: the key, `-` in front to reverse */
   onSort: (param: string) => void;
   className?: string;
   /** the column's first-click order: biggest first for most, ascending for
    * names A to Z and dates soonest first */
   order?: 'ascending' | 'descending';
}) {
   const active = sort.key === sortKey;
   const flipped = order === 'ascending' ? 'descending' : 'ascending';
   // the cell carries the column's width and hiding; the button only its words
   return (
      <span
         role="columnheader"
         className={className}
         aria-sort={active ? (sort.reversed ? flipped : order) : undefined}
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
