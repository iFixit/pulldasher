import { useContext, useEffect, useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { n } from '../../../../shared/format';
import type { DecideRow } from '../../../../shared/model/decide';
import {
   checkInitiativeFields,
   goingProjects,
   homesOf,
   initiativeSpan,
   type Initiative,
   type InitiativeFields,
} from '../../../../shared/model/initiatives';
import {
   healthStanding,
   isUnderWay,
   planFor,
   type RoadmapItem,
} from '../../../../shared/model/roadmap';
import { EmptyState, FactLink, QuietButton, textInputClass } from '../../components/bits';
import { Fold, Rows } from '../../components/Lane';
import { Icon } from '../../components/Icon';
import {
   byRank,
   fileProject,
   updateInitiative,
   useInitiativesValue,
   type Home,
} from '../../model/initiativesData';
import { guessHome, homeChoices, UNSORTED } from '../../model/initiativeBoard';
import { dayWords } from '../../model/projectData';
import { stageWord, type PortfolioItem } from '../../model/portfolio';
import { andList, UNSORTED_WORD } from '../../model/words';
import {
   AllItemsContext,
   answerWords,
   arrowsAmong,
   askedInitiative,
   DecideCall,
   initiativeById,
   primaryOf,
   reasonParts,
   type Call,
   type Filed,
} from './Decide';
import { openPlan, type Navigate, type ProjectsNav } from './parts';
import { PLAN_STATUS_WORD, planWords } from './roadmapHealth';

/** "Release safety", "Keep the lights on", "Not tracked", "Unsorted": a
 * home by name, standing alone. */
export const homeName = (home: Pick<Initiative, 'name'> | null | undefined) =>
   home ? home.name : UNSORTED_WORD;

/** A receipt for a move of home: what it did, with Undo, or why not. */
interface MoveReceipt {
   words: string;
   failed?: boolean;
   undo?: () => void;
}

/**
 * Where a project lives, in its page's head: "in Release safety · Move",
 * "Not tracked · Move", or "Unsorted · Move". The initiative's name opens
 * its page. Move opens a chooser in place of those words (never a popover):
 * the homes in rank order, Not tracked last, and Unsorted; Move, on once the
 * pick differs, files it there and leaves a receipt with Undo, which puts
 * back the home it had with its time and count.
 */
export function HomeLine({
   slug,
   initiatives,
   navigate,
   onSaid,
}: {
   slug: string;
   initiatives: readonly Initiative[];
   navigate: Navigate;
   /** say a change aloud, for a screen reader */
   onSaid?: (words: string) => void;
}) {
   const home = homesOf(initiatives).get(slug)?.initiative ?? null;
   const [moving, setMoving] = useState(false);
   const [pick, setPick] = useState(home?.slug ?? '');
   const [receipt, setReceipt] = useState<MoveReceipt | null>(null);
   const selectId = useId();
   const moveId = useId();
   const doneRef = useRef<HTMLSpanElement>(null);
   useEffect(() => {
      if (receipt) doneRef.current?.focus();
   }, [receipt]);
   const choices = homeChoices(initiatives);
   const say = (r: MoveReceipt) => {
      setReceipt(r);
      onSaid?.(r.words);
   };
   const move = async () => {
      const to = pick || null;
      setMoving(false);
      if (to === (home?.slug ?? null)) return;
      const toName = homeName(choices.find(i => i.slug === to));
      const saved = await fileProject(slug, to, { expect: home?.slug ?? null });
      if ('error' in saved) return say({ words: saved.error.replace(/\.$/, ''), failed: true });
      const before: Home = saved.before;
      say({
         words: `Moved to ${toName}`,
         undo: async () => {
            const back = await fileProject(slug, before.initiative, {
               set_at: before.set_at,
               baseline_prs: before.baseline_prs,
            });
            if ('error' in back) say({ words: back.error.replace(/\.$/, ''), failed: true });
            else {
               setReceipt(null);
               setPick(before.initiative ?? '');
               onSaid?.(`Put it back in ${homeName(home)}`);
               requestAnimationFrame(() => document.getElementById(moveId)?.focus());
            }
         },
      });
   };
   return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
         {moving ? null : home ? (
            home.kind === 'untracked' ? (
               <span>Not tracked</span>
            ) : (
               <span>
                  in{' '}
                  <FactLink
                     onClick={() => navigate({ initiative: home.slug, project: null })}
                     title={`Open ${home.name}: its projects, owner and goal`}
                  >
                     {home.name}
                  </FactLink>
               </span>
            )
         ) : (
            <span>{UNSORTED_WORD}</span>
         )}
         {!moving && !receipt && (
            <QuietButton
               id={moveId}
               onClick={() => {
                  setPick(home?.slug ?? '');
                  setMoving(true);
               }}
               aria-label="Move it to another initiative"
            >
               Move
            </QuietButton>
         )}
         {moving && (
            <span className="inline-flex flex-wrap items-center gap-2">
               <label htmlFor={selectId}>Move to</label>
               <select
                  id={selectId}
                  autoFocus
                  value={pick}
                  onChange={e => setPick(e.target.value)}
                  onKeyDown={e => {
                     if (e.key === 'Escape') setMoving(false);
                  }}
                  className={`h-7 px-2 text-[13px] text-ink ${textInputClass}`}
               >
                  {choices.map(i => (
                     <option key={i.slug} value={i.slug}>
                        {i.name}
                     </option>
                  ))}
                  <option value="">{UNSORTED_WORD}</option>
               </select>
               <QuietButton
                  onClick={() => void move()}
                  disabled={(pick || null) === (home?.slug ?? null)}
                  title={
                     (pick || null) === (home?.slug ?? null) ? 'Choose another home first' : undefined
                  }
               >
                  Move
               </QuietButton>
               <QuietButton onClick={() => setMoving(false)}>Cancel</QuietButton>
            </span>
         )}
         {receipt && (
            <span role="status" className="inline-flex items-center gap-2 text-ink-2">
               {!receipt.failed && (
                  <Icon icon={Check} size={14} className="inline-block align-[-2px]" />
               )}
               <span ref={doneRef} tabIndex={-1} className="rounded">
                  {receipt.words}.
               </span>
               {receipt.undo ? (
                  <QuietButton onClick={receipt.undo}>Undo</QuietButton>
               ) : (
                  <QuietButton onClick={() => setReceipt(null)}>Close</QuietButton>
               )}
            </span>
         )}
      </span>
   );
}

/**
 * What an initiative's plans owe, in words: "1 off track, 1 update owed",
 * or "nothing owed". Read off its plans under way, as their rows say it;
 * an initiative keeps no health of its own.
 */
export function healthWords(
   plans: readonly Pick<
      RoadmapItem,
      | 'status'
      | 'start'
      | 'weeks'
      | 'end_kind'
      | 'update'
      | 'created_at'
      | 'lately'
      | 'untracked'
      | 'updated_at'
   >[],
   now: number = Date.now() / 1000
): string {
   let owed = 0;
   const said = { off_track: 0, at_risk: 0 };
   for (const plan of plans) {
      if (!isUnderWay(plan.status)) continue;
      const standing = healthStanding(plan, now);
      if (standing.kind === 'missing' || standing.kind === 'stale') owed++;
      const u = plan.update;
      // a word the plan has changed since is answered
      if (u && u.health !== 'on_track' && u.at > (plan.updated_at ?? 0)) said[u.health]++;
   }
   const parts = [
      said.off_track ? `${said.off_track} off track` : '',
      said.at_risk ? `${said.at_risk} at risk` : '',
      owed ? `${n(owed, 'update')} owed` : '',
   ].filter(Boolean);
   return parts.length ? parts.join(', ') : 'nothing owed';
}

/** Who leads its live plans, most first: "brettlhartt leads 6 of 7 live
 * plans; danielbeardsley 1". Empty with none. */
export function leadWords(plans: readonly Pick<RoadmapItem, 'status' | 'lead'>[]): string {
   const live = plans.filter(p => isUnderWay(p.status));
   const counts = new Map<string, number>();
   for (const p of live) if (p.lead) counts.set(p.lead, (counts.get(p.lead) ?? 0) + 1);
   const sorted = [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
   if (!sorted.length) return '';
   const [[first, most], ...rest] = sorted;
   return [
      `${first} leads ${most} of ${n(live.length, 'live plan')}`,
      ...rest.map(([login, count]) => `${login} ${count}`),
   ].join('; ');
}

/** "May 4 to Jan 17, from 7 live plans · 1 ongoing": its span in a line. */
function spanLine(span: ReturnType<typeof initiativeSpan>, live: number): string {
   if (!span.start) return 'No plans yet';
   const dates = span.end
      ? `${dayWords(span.start)} to ${dayWords(span.end)}`
      : span.end_kind === 'ended' && span.ended
      ? `${dayWords(span.start)} to ${dayWords(span.ended)}`
      : `Since ${dayWords(span.start)}`;
   const from = live ? `, from ${n(live, 'live plan')}` : '';
   return `${dates}${from}${span.ongoing ? ` · ${span.ongoing} ongoing` : ''}`;
}

/** "estimated, from its projects", "ongoing", "every plan in it is
 * finished": how firm its end is, derived from its plans, never stored. */
function endWords(span: ReturnType<typeof initiativeSpan>): string {
   switch (span.end_kind) {
      case 'soft':
         return 'estimated, from its projects';
      case 'ongoing':
         return 'ongoing, no plan in it has an end';
      case 'ended':
         return 'every plan in it is finished';
      default:
         return 'no plans yet';
   }
}

/** An initiative's name, goal and owner, edited in place: Save leaves a
 * receipt with Undo, never a modal. */
function EditFields({
   initiative,
   onDone,
}: {
   initiative: Initiative;
   onDone: (receipt: MoveReceipt | null) => void;
}) {
   const [name, setName] = useState(initiative.name);
   const [goal, setGoal] = useState(initiative.goal);
   const [owner, setOwner] = useState(initiative.owner ?? '');
   const [problem, setProblem] = useState<string | null>(null);
   const ids = { name: useId(), goal: useId(), owner: useId() };
   const save = async () => {
      const checked = checkInitiativeFields({ name, goal, owner }, { partial: true });
      if ('error' in checked) return setProblem(checked.error);
      const changed = Object.fromEntries(
         Object.entries(checked.fields).filter(
            ([k, v]) => v !== (initiative as unknown as Record<string, unknown>)[k]
         )
      ) as Partial<InitiativeFields>;
      if (!Object.keys(changed).length) return onDone(null);
      const r = await updateInitiative(initiative.id, changed);
      if ('error' in r) return setProblem(r.error);
      const back = Object.fromEntries(
         Object.keys(changed).map(k => [k, (r.was as unknown as Record<string, unknown>)[k]])
      ) as Partial<InitiativeFields>;
      onDone({
         words: `Saved ${andList(
            Object.keys(changed).map(k => (k === 'owner' ? 'its owner' : `its ${k}`))
         )}`,
         undo: () =>
            void updateInitiative(initiative.id, back, {
               undo: {
                  updated_at: r.was.updated_at ?? Math.floor(Date.now() / 1000),
                  status_at: r.was.status_at,
               },
            }).then(u =>
               // a failed Undo keeps its receipt, saying why
               onDone('error' in u ? { words: u.error.replace(/\.$/, ''), failed: true } : null)
            ),
      });
   };
   const field = `h-8 w-full px-2.5 text-[13px] text-ink ${textInputClass}`;
   return (
      <form
         onSubmit={e => {
            e.preventDefault();
            void save();
         }}
         onKeyDown={e => {
            if (e.key === 'Escape') onDone(null);
         }}
         className="mt-3 grid max-w-[40rem] gap-2 text-xs text-ink-3 sm:grid-cols-[7rem_1fr] sm:items-center"
      >
         <label htmlFor={ids.name}>Name</label>
         <input
            id={ids.name}
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            className={field}
         />
         <label htmlFor={ids.goal}>Goal</label>
         <input
            id={ids.goal}
            value={goal}
            onChange={e => setGoal(e.target.value)}
            className={field}
         />
         <label htmlFor={ids.owner}>Owner</label>
         <input
            id={ids.owner}
            value={owner}
            onChange={e => setOwner(e.target.value)}
            placeholder="A GitHub login"
            className={field}
         />
         <span />
         <span className="flex flex-wrap items-center gap-2">
            <button
               type="submit"
               className="hit pressable inline-flex h-8 items-center rounded-lg border border-brand bg-brand px-3 text-[13px] font-medium text-surface hover:opacity-90"
            >
               Save
            </button>
            <QuietButton onClick={() => onDone(null)}>Cancel</QuietButton>
            {problem && <span className="text-ink-2">{problem}</span>}
         </span>
      </form>
   );
}

/**
 * An initiative's page, the same anatomy as a project's: its name and
 * owner (Edit, in place), its goal, Decide's questions about it (whether it
 * reached its goal, or, closed, whether to reopen it for a project still
 * worked on), its span, how firm its end is and what its plans owe, all
 * read off its projects' plans; then the projects in it in priority order,
 * each with its plan in words and any question Decide asks of it, and a
 * "Done or dropped" fold for the finished, dropped and parked work nobody
 * is asked about and nothing is going in. Not tracked's page is its ledger:
 * no owner, edit, span or end.
 */
export function InitiativePage({
   slug,
   initiatives,
   items,
   plans,
   calls,
   nav,
   navigate,
   onPerson,
}: {
   slug: string;
   initiatives: readonly Initiative[] | null;
   /** every project, Not tracked ones too */
   items: readonly PortfolioItem[];
   /** every plan; null while they load */
   plans: readonly RoadmapItem[] | null;
   /** Decide's rows with this visit's calls kept */
   calls: readonly DecideRow[];
   nav: ProjectsNav;
   navigate: Navigate;
   onPerson: (login: string) => void;
}) {
   const [editing, setEditing] = useState(false);
   const [receipt, setReceipt] = useState<MoveReceipt | null>(null);
   const initiative = initiatives?.find(i => i.slug === slug);
   useEffect(() => {
      if (!initiative) return;
      const was = document.title;
      document.title = `${initiative.name} · Pulldasher`;
      return () => {
         document.title = was;
      };
   }, [initiative?.name]);
   if (!initiatives || !plans)
      return <p className="text-[13px] text-ink-3">Loading the initiative…</p>;
   if (!initiative) {
      return (
         <EmptyState
            variant="search"
            title="No initiative by that name"
            sub={`No initiative has the slug ${slug}.`}
         />
      );
   }
   const ledger = initiative.kind === 'untracked';
   const slugs = initiative.projects.map(f => f.project);
   const mine = plans.filter(p => p.project && slugs.includes(p.project));
   const span = initiativeSpan(slugs, plans);
   const live = mine.filter(p => isUnderWay(p.status));
   const bySlug = new Map(items.map(i => [i.slug, i]));
   // Decide's questions about the initiative itself, at the page's head,
   // and the rest under the project each is about
   const aboutIt = calls.filter(r => askedInitiative(r) === initiative.id);
   const asksOf = (s: string) => calls.filter(r => r.slug === s && !aboutIt.includes(r));
   // still going by the rule the close guard uses: a plan under way or PRs open
   const going = new Set(goingProjects(slugs, plans, s => bySlug.get(s)?.open ?? 0));
   // the projects in it by their plan's priority, those with no plan after
   const rows = slugs
      .map(s => ({ slug: s, item: bySlug.get(s), plan: planFor(s, plans) }))
      .sort(
         (a, b) =>
            (a.plan?.priority ?? Infinity) - (b.plan?.priority ?? Infinity) ||
            (a.item?.name ?? a.slug).localeCompare(b.item?.name ?? b.slug)
      );
   // finished: nothing going, and nothing Decide asks of it or about it
   const finished = (r: typeof rows[number]) =>
      !going.has(r.slug) &&
      !calls.some(c => c.slug === r.slug && c.reasons.length) &&
      (r.plan ? !isUnderWay(r.plan.status) : r.item ? r.item.stage === 'closed' : false);
   const shown = rows.filter(r => !finished(r));
   const done = rows.filter(finished);
   const owed = calls.filter(
      r => r.reasons.length && (aboutIt.includes(r) || (!!r.slug && slugs.includes(r.slug)))
   ).length;
   const kindWord =
      initiative.kind === 'upkeep' && initiative.name !== 'Upkeep'
         ? 'Upkeep'
         : ledger && initiative.name !== 'Not tracked'
         ? 'Not tracked'
         : null;
   const question = (r: DecideRow, named: string) => {
      const primary = primaryOf(r);
      const parts = r.reasons.length ? reasonParts(primary, r.item) : null;
      const project = r.slug ? bySlug.get(r.slug) : undefined;
      return (
         <div key={`${r.slug ?? ''}:${r.item?.id ?? ''}`} className="mt-1.5 text-[13px]">
            {parts && (
               <p className="m-0 max-w-[70ch] text-ink-2">
                  {named}
                  {parts.facts} <span className="text-warn">{parts.question}</span>
               </p>
            )}
            <DecideCall row={r} project={project} />
         </div>
      );
   };
   const row = (r: typeof rows[number]) => {
      const name = r.item?.name ?? r.plan?.name ?? r.slug;
      const lead = r.plan?.lead ?? r.item?.lead ?? null;
      return (
         <div
            key={r.slug}
            className="border-t border-secondary px-3.5 py-2 text-[13px] first:border-t-0"
         >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
               <FactLink onClick={() => navigate({ project: r.slug, initiative: null })}>
                  {name}
               </FactLink>
               {lead && (
                  <FactLink className="text-xs" onClick={() => onPerson(lead)}>
                     {lead}
                  </FactLink>
               )}
               <span className="text-ink-3">
                  {r.plan ? (
                     <FactLink
                        className="text-ink-3"
                        onClick={() => navigate(openPlan(nav, r.plan?.id as number))}
                        title="Open its plan on the roadmap"
                     >
                        {PLAN_STATUS_WORD[r.plan.status]}, {planWords(r.plan)}
                     </FactLink>
                  ) : r.item ? (
                     `No plan · ${stageWord(r.item)}`
                  ) : (
                     'No plan'
                  )}
               </span>
               {!!r.item?.open && (
                  <span className="text-xs text-ink-3">· {n(r.item.open, 'open PR')}</span>
               )}
            </div>
            {/* a call is made where it's seen: the question its row asks
                anywhere else, collapsed to its suggested answer */}
            {asksOf(r.slug).map(a => question(a, ''))}
         </div>
      );
   };
   const facts: [string, string][] = ledger
      ? [['Health', owed ? `${n(owed, 'question')} on Decide` : 'nothing owed']]
      : [
           ['Span', spanLine(span, live.length)],
           ['Ends', endWords(span)],
           [
              'Health',
              [healthWords(live), owed ? `${n(owed, 'question')} on Decide` : '']
                 .filter(w => w && w !== 'nothing owed')
                 .join(', ') || 'nothing owed',
           ],
           ['People', leadWords(mine) || 'No lead named on its plans'],
        ];
   return (
      <>
         <div className="mb-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
               <h2 className="m-0 text-xl font-semibold leading-7">{initiative.name}</h2>
               {kindWord && <span className="text-[13px] text-ink-3">{kindWord}</span>}
               {initiative.status !== 'open' && (
                  <span className="text-[13px] text-ink-3">Closed as {initiative.status}</span>
               )}
               {!ledger && (
                  <span className="flex items-center gap-2 text-xs text-ink-3 sm:ml-auto">
                     {initiative.owner ? (
                        <span>
                           Owner{' '}
                           <FactLink onClick={() => onPerson(initiative.owner as string)}>
                              {initiative.owner}
                           </FactLink>
                        </span>
                     ) : (
                        'No owner'
                     )}
                     {!editing && (
                        <QuietButton
                           onClick={() => setEditing(true)}
                           aria-label={`Edit ${initiative.name}`}
                        >
                           Edit
                        </QuietButton>
                     )}
                  </span>
               )}
            </div>
            {initiative.goal && (
               <p className="m-0 mt-1 max-w-[70ch] text-[13px] text-ink-2">{initiative.goal}</p>
            )}
            {editing && (
               <EditFields
                  initiative={initiative}
                  onDone={r => {
                     setEditing(false);
                     setReceipt(r);
                  }}
               />
            )}
            {receipt && (
               <p role="status" className="m-0 mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                  {!receipt.failed && (
                     <Icon icon={Check} size={14} className="inline-block align-[-2px]" />
                  )}
                  {receipt.words}.
                  {receipt.undo ? (
                     <QuietButton onClick={receipt.undo}>Undo</QuietButton>
                  ) : (
                     <QuietButton onClick={() => setReceipt(null)}>Close</QuietButton>
                  )}
               </p>
            )}
            {aboutIt.map(r =>
               question(r, r.slug ? `${bySlug.get(r.slug)?.name ?? r.slug}: ` : '')
            )}
         </div>
         <dl className="mb-8 grid max-w-[48rem] gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-[7rem_1fr]">
            {facts.map(([term, words]) => (
               <div key={term} className="contents">
                  <dt className="text-xs leading-5 text-ink-3">{term}</dt>
                  <dd className="m-0 text-ink-2">{words}</dd>
               </div>
            ))}
         </dl>
         <section aria-labelledby="initiative-projects" className="mb-8">
            <h3 id="initiative-projects" className="m-0 mb-3 text-[13px] font-semibold text-ink">
               Projects in it
            </h3>
            {rows.length ? (
               <Rows>
                  {shown.map(row)}
                  <Fold
                     count={done.length}
                     label="Done or dropped"
                     gloss="Its projects whose plans are done, dropped or parked, or that closed with no plan, with no PRs open and nothing Decide asks."
                     id={`initiative:${initiative.slug}:done`}
                  >
                     {done.map(row)}
                  </Fold>
               </Rows>
            ) : (
               <p className="m-0 text-[13px] text-ink-3">
                  No projects in it yet. File one from its page’s Move, or from Decide.
               </p>
            )}
         </section>
      </>
   );
}

/** The chooser's label, on every question that files a project. */
const FILE_IT_IN = 'File it in';

/**
 * The File it in chooser on a row Decide asks to plan or to file (a new or
 * unfiled project): where the project goes, filed with whatever call the row
 * gets. It starts on the home it has, so taking any answer blind moves
 * nothing; only a project with no home starts on a guess, the initiative its
 * people work in most. `filed` is the filing the next call carries, when the
 * pick differs from its home; `picked` once a person chose.
 */
export function useHomeChooser(row: DecideRow, { away = false }: { away?: boolean } = {}) {
   const { initiatives } = useInitiativesValue();
   const items = useContext(AllItemsContext);
   const asks = row.reasons.some(r => r.kind === 'new' || r.kind === 'unfiled');
   const list = initiatives ?? [];
   const current = row.slug ? homesOf(list).get(row.slug)?.initiative ?? null : null;
   // `away`: moving it out of the home it has (Track it, Move the project),
   // so it starts on the guess
   const guess =
      (!current || away) && row.slug && list.length ? guessHome(row.slug, items, list) : null;
   const [pick, setPick] = useState<string | null>(null);
   const choices = homeChoices(list);
   const chosen = pick ?? (away ? guess?.slug : current?.slug ?? guess?.slug) ?? '';
   const to = choices.find(i => i.slug === chosen);
   return {
      shown: asks && !!row.slug && choices.length > 0,
      choices,
      chosen,
      current,
      picked: pick != null,
      guessed: pick == null && (!current || away) && !!guess && chosen === guess.slug,
      setPick,
      filed:
         to && to.slug !== current?.slug
            ? ({
                 to: to.slug,
                 name: to.name,
                 from: current?.slug ?? null,
                 untracked: to.kind === 'untracked',
              } as Filed)
            : undefined,
   };
}

/** The chooser's line, above the answers that use it: "File it in [Release
 * safety]", with "guessed" while it shows the board's guess. A select, so
 * the keyboard and a screen reader get the platform's own list. */
export function HomeChooser({
   name,
   chooser,
}: {
   name: string;
   chooser: Pick<ReturnType<typeof useHomeChooser>, 'chosen' | 'choices' | 'guessed' | 'setPick'>;
}) {
   const id = useId();
   return (
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
         <label htmlFor={id} className="w-full sm:w-32 sm:shrink-0">
            {FILE_IT_IN}
         </label>
         <select
            id={id}
            aria-label={`${FILE_IT_IN}: ${name}`}
            value={chooser.chosen}
            onChange={e => chooser.setPick(e.target.value)}
            className={`h-8 px-2 text-[13px] text-ink ${textInputClass}`}
         >
            {!chooser.chosen && <option value="">Choose where it goes</option>}
            {chooser.choices.map(i => (
               <option key={i.slug} value={i.slug}>
                  {i.name}
               </option>
            ))}
         </select>
         {chooser.guessed && (
            <span
               className="underline decoration-dotted underline-offset-2"
               title={`It’s ${UNSORTED_WORD}. This is the initiative its people work in most.`}
            >
               guessed
            </span>
         )}
      </div>
   );
}

/** A plan's project chooser, for a plan with no project: "Its project [▾]". */
function ProjectChooser({
   name,
   value,
   onChange,
}: {
   name: string;
   value: string;
   onChange: (slug: string) => void;
}) {
   const id = useId();
   const items = useContext(AllItemsContext);
   const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
   return (
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
         <label htmlFor={id} className="w-full sm:w-32 sm:shrink-0">
            Its project
         </label>
         <select
            id={id}
            aria-label={`The project ${name} is`}
            value={value}
            onChange={e => onChange(e.target.value)}
            className={`h-8 max-w-full px-2 text-[13px] text-ink ${textInputClass}`}
         >
            {!value && <option value="">Choose its project</option>}
            {sorted.map(i => (
               <option key={i.slug} value={i.slug}>
                  {i.name}
               </option>
            ))}
         </select>
      </div>
   );
}

/**
 * The answers to a row that asks where a project belongs, or about an
 * initiative, in the same shape as Decide's CallStrip: a chooser first when
 * the answer needs one, then the suggested answer filled, then the others.
 * Unsorted: File in the chooser's pick. No project yet: Link to the chosen
 * project. Not tracked, but growing: Keep not tracked, or Track it, which
 * opens the chooser. Goal maybe reached: Close as done, or Close as dropped
 * or Keep open. Its initiative closed: Reopen it, or move the project with
 * the chooser. An answer that waits on an empty chooser is outlined and
 * off, and only an answer the board picked says Suggested.
 */
export function HomeStrip({
   row,
   name,
   describedBy,
   onCall,
}: {
   row: DecideRow;
   name: string;
   describedBy?: string;
   onCall: (call: Call) => void;
}) {
   const [more, setMore] = useState(false);
   const [project, setProject] = useState('');
   const items = useContext(AllItemsContext);
   const primary = primaryOf(row);
   const chooser = useHomeChooser(row, { away: primary.kind !== 'unfiled' });
   const initiative = initiativeById(askedInitiative(row));
   // a Track it or a move goes to an initiative, never Not tracked or the
   // closed one it's in
   const pickable =
      primary.kind === 'unfiled'
         ? chooser.choices
         : chooser.choices.filter(i => i.kind !== 'untracked' && i.slug !== initiative?.slug);
   const chosen = pickable.find(i => i.slug === chooser.chosen);
   const filing: Call | null = chosen
      ? { kind: 'file', to: chosen.slug, name: chosen.name, untracked: chosen.kind === 'untracked' }
      : null;
   const fileOption = { call: filing, words: filing ? answerWords(filing, null) : 'File it' };
   const notTracked = chooser.choices.find(i => i.kind === 'untracked');
   const linked = items.find(i => i.slug === project);
   type Option = { call: Call | null; words: string; suggested?: boolean };
   const options: Option[] =
      primary.kind === 'unfiled'
         ? [{ ...fileOption, suggested: chooser.guessed }]
         : primary.kind === 'no_project'
         ? [
              {
                 call: linked ? { kind: 'link', project: linked.slug, name: linked.name } : null,
                 words: linked ? `Link to ${linked.name}` : 'Link it',
              },
           ]
         : primary.kind === 'untracked_grew'
         ? [
              {
                 call: notTracked ? { kind: 'keep_untracked', to: notTracked.slug } : null,
                 words: 'Keep not tracked',
                 suggested: true,
              },
              ...(more ? [fileOption] : []),
           ]
         : primary.kind === 'goal_reached'
         ? [
              { call: { kind: 'close', as: 'done' }, words: 'Close as done', suggested: true },
              ...(more
                 ? [
                      { call: { kind: 'close', as: 'dropped' } as Call, words: 'Close as dropped' },
                      { call: { kind: 'keep_open' } as Call, words: 'Keep open' },
                   ]
                 : []),
           ]
         : [
              {
                 call: { kind: 'reopen' },
                 words: initiative ? `Reopen ${initiative.name}` : 'Reopen it',
                 suggested: true,
              },
              ...(more ? [fileOption] : []),
           ];
   const moreWords =
      primary.kind === 'untracked_grew'
         ? 'Track it'
         : primary.kind === 'reopened_in_closed'
         ? 'Move the project'
         : 'Other answers';
   // Track it and Move the project open the chooser; it starts on a guess,
   // never on the home being left
   const chooses =
      primary.kind === 'unfiled' ||
      (more && (primary.kind === 'untracked_grew' || primary.kind === 'reopened_in_closed'));
   return (
      <div className="flex flex-col">
         {primary.kind === 'no_project' && (
            <ProjectChooser name={name} value={project} onChange={setProject} />
         )}
         {chooses && pickable.length > 0 && (
            <HomeChooser
               name={name}
               chooser={{ ...chooser, choices: pickable, chosen: chosen?.slug ?? '' }}
            />
         )}
         <div
            role="toolbar"
            aria-label={`Decisions for ${name}`}
            onKeyDown={arrowsAmong}
            className="flex flex-wrap items-center gap-2"
         >
            {options.map((o, k) => {
               const filled = k === 0 && !!o.call;
               return (
                  <button
                     key={o.words}
                     type="button"
                     tabIndex={k === 0 ? 0 : -1}
                     data-decide-focus={k === 0 || undefined}
                     aria-describedby={k === 0 ? describedBy : undefined}
                     aria-label={`${o.words}: ${name}`}
                     disabled={!o.call}
                     title={o.call ? undefined : 'Choose one above first'}
                     onClick={() => o.call && onCall(o.call)}
                     className={`hit pressable inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium disabled:opacity-60 ${
                        // filled only when there's an answer to make
                        filled
                           ? 'border-brand bg-brand text-surface hover:opacity-90'
                           : 'border-line bg-surface text-ink-2 hover:border-brand hover:text-brand'
                     }`}
                  >
                     {o.words}
                     {filled && o.suggested && (
                        <span className="text-[11px] font-normal opacity-80">Suggested</span>
                     )}
                  </button>
               );
            })}
            {primary.kind !== 'unfiled' && primary.kind !== 'no_project' && !more && (
               <button
                  type="button"
                  tabIndex={-1}
                  aria-expanded={false}
                  aria-label={`${moreWords}: ${name}`}
                  onClick={() => setMore(true)}
                  className="hit pressable inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 hover:border-brand hover:text-brand"
               >
                  {moreWords}
               </button>
            )}
         </div>
      </div>
   );
}

/**
 * Decide's Initiative switch, beside the team switch: an owner runs their
 * slice. A select, since there can be twenty; each names how many are owed,
 * and only the ones with something owed are offered (and the one picked):
 * the open homes in rank order, a closed initiative while a project in it
 * is asked about, then Unsorted.
 */
export function InitiativeSwitch({
   initiatives,
   owedIn,
   value,
   onChange,
}: {
   initiatives: readonly Initiative[];
   owedIn: (slug: string) => number;
   value: string | null;
   onChange: (slug: string | null) => void;
}) {
   const id = useId();
   const counted = (label: string, count: number) => (count ? `${label} · ${count}` : label);
   const closed = byRank(initiatives).filter(i => i.status !== 'open');
   const offered = [
      ...[...homeChoices(initiatives), ...closed].map(i => [i.slug, i.name] as const),
      [UNSORTED, UNSORTED_WORD] as const,
   ].filter(([slug]) => owedIn(slug) > 0 || slug === value);
   if (!offered.length) return null;
   return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
         <label htmlFor={id}>Initiative</label>
         <select
            id={id}
            value={value ?? ''}
            onChange={e => onChange(e.target.value || null)}
            className={`h-8 px-2 text-[13px] text-ink ${textInputClass}`}
         >
            <option value="">All initiatives</option>
            {offered.map(([slug, name]) => (
               <option key={slug} value={slug}>
                  {counted(name, owedIn(slug))}
               </option>
            ))}
         </select>
      </div>
   );
}
