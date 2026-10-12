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
import { fileProject, updateInitiative, type Home } from '../../model/initiativesData';
import { closedWords, homeChoices } from '../../model/initiativeBoard';
import { dayWords } from '../../model/projectData';
import { stageWord, type PortfolioItem } from '../../model/portfolio';
import { andList, UNSORTED_WORD } from '../../model/words';
import { DecideCall } from './Decide';
import {
   AllItemsContext,
   askedInitiative,
   primaryOf,
   reasonParts,
} from '../../model/decideCalls';
import { openPlan, type Navigate, type ProjectsNav } from './parts';
import { PLAN_STATUS_WORD, planWords } from './roadmapHealth';

/** "Release safety", "Keep the lights on", "Not tracked", "Unsorted": a
 * home by name, standing alone. */
export const homeName = (home: Pick<Initiative, 'name'> | null | undefined) =>
   home ? home.name : UNSORTED_WORD;

/** A receipt for a filing: what it did, with Undo, or why not. */
interface MoveReceipt {
   words: string;
   failed?: boolean;
   undo?: () => void;
   /** what an Undo did: held in the receipt's place with nothing to click */
   settled?: boolean;
}

/**
 * Where a project lives, in its page's head: "in Release safety · File
 * elsewhere", "Not tracked · …", or "Unsorted · …". The initiative's name
 * opens its page. File elsewhere opens a chooser in place of those words
 * (never a popover): the homes in rank order, Not tracked last, and
 * Unsorted; File, on once the pick differs, files it there and leaves a
 * receipt with Undo, which puts back the home it had with its time and
 * count. Undo's own words then hold the receipt's place, and File
 * elsewhere comes back on the line below, never under the pointer.
 */
export function HomeLine({
   slug,
   initiatives,
   navigate,
   onSaid,
   movable = true,
}: {
   slug: string;
   initiatives: readonly Initiative[];
   navigate: Navigate;
   /** say a change aloud, for a screen reader */
   onSaid?: (words: string) => void;
   /** false while another control on the page files it (Decide's question) */
   movable?: boolean;
}) {
   const home = homesOf(initiatives).get(slug)?.initiative ?? null;
   const projectName = useContext(AllItemsContext).find(i => i.slug === slug)?.name ?? slug;
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
         words: `Filed in ${toName}`,
         undo: async () => {
            const back = await fileProject(slug, before.initiative, {
               set_at: before.set_at,
               baseline_prs: before.baseline_prs,
            });
            if ('error' in back) say({ words: back.error.replace(/\.$/, ''), failed: true });
            else {
               setPick(before.initiative ?? '');
               say({ words: `Put ${projectName} back in ${homeName(home)}`, settled: true });
            }
         },
      });
   };
   return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
         {/* the receipt names the new home; saying it beside would repeat it */}
         {moving || (receipt && !receipt.failed) ? null : home ? (
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
         {moving && (
            <span className="inline-flex flex-wrap items-center gap-2">
               <label htmlFor={selectId}>File in</label>
               <select
                  id={selectId}
                  autoFocus
                  value={pick}
                  onChange={e => setPick(e.target.value)}
                  onKeyDown={e => {
                     if (e.key !== 'Escape') return;
                     setMoving(false);
                     requestAnimationFrame(() => document.getElementById(moveId)?.focus());
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
                  File
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
               ) : receipt.settled ? null : (
                  <QuietButton onClick={() => setReceipt(null)}>Close</QuietButton>
               )}
            </span>
         )}
         {movable && !moving && (!receipt || receipt.settled) && (
            <>
               {/* after an Undo, on its own line below the words */}
               {receipt && <span aria-hidden className="basis-full" />}
               <QuietButton
                  id={moveId}
                  onClick={() => {
                     setReceipt(null);
                     setPick(home?.slug ?? '');
                     setMoving(true);
                  }}
                  aria-label={`File elsewhere: ${projectName}`}
               >
                  File elsewhere
               </QuietButton>
            </>
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

/** With no plan under way naming a lead, its projects' leads as their rows
 * say them: "danielbeardsley (guessed) leads 1". */
export function projectLeadWords(
   items: readonly Pick<PortfolioItem, 'lead' | 'leadByPrs'>[]
): string {
   const counts = new Map<string, number>();
   for (const i of items) {
      if (!i.lead) continue;
      const who = i.leadByPrs ? `${i.lead} (guessed)` : i.lead;
      counts.set(who, (counts.get(who) ?? 0) + 1);
   }
   return [...counts]
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([who, count]) => `${who} leads ${count}`)
      .join('; ');
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
            sub="No initiative is at this link."
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
           // a closed one's head says how it closed; its end isn't estimated
           ...(initiative.status === 'open'
              ? [['Ends', endWords(span)] as [string, string]]
              : []),
           [
              'Health',
              [healthWords(live), owed ? `${n(owed, 'question')} on Decide` : '']
                 .filter(w => w && w !== 'nothing owed')
                 .join(', ') || 'nothing owed',
           ],
           [
              'People',
              leadWords(mine) ||
                 projectLeadWords(slugs.flatMap(s => bySlug.get(s) ?? [])) ||
                 'No lead named on its plans',
           ],
        ];
   return (
      <>
         <div className="mb-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
               <h2 className="m-0 text-xl font-semibold leading-7">{initiative.name}</h2>
               {kindWord && <span className="text-[13px] text-ink-3">{kindWord}</span>}
               {initiative.status !== 'open' && (
                  <span className="text-[13px] text-ink-3">{closedWords(initiative)}</span>
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
                  No projects in it yet. File one from a project’s page, or from Decide.
               </p>
            )}
         </section>
      </>
   );
}
