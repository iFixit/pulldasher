/**
 * The home answers Decide draws on a row: the File it in chooser and its
 * hook, the strip that answers where a project belongs or an initiative's own
 * question, and Decide's Initiative switch. It reads the question model
 * (model/decideCalls.ts) and never Decide.tsx, so Decide imports it without
 * a cycle.
 */
import { useContext, useId, useState, type ReactNode } from 'react';
import { createMemoryStore } from '../../storage';
import type { PortfolioItem } from '../../model/portfolio';
import type { DecideRow } from '../../../../shared/model/decide';
import { homesOf, type Initiative } from '../../../../shared/model/initiatives';
import { textInputClass } from '../../components/bits';
import { byRank, useInitiativesValue } from '../../model/initiativesData';
import { guessHome, homeChoices, NO_PROJECT, UNSORTED } from '../../model/initiativeBoard';
import { NO_PROJECT_YET, UNSORTED_WORD } from '../../model/words';
import {
   AllItemsContext,
   answerWords,
   arrowsAmong,
   askedInitiative,
   initiativeById,
   primaryOf,
   type Call,
   type Filed,
} from '../../model/decideCalls';

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
   const { picks } = homePicks.useValue();
   const pick = row.slug ? picks.get(row.slug) ?? null : null;
   return {
      ...homeChoice(row, initiatives ?? [], items, pick, away),
      setPick: (slug: string) => row.slug && setHomePick(row.slug, slug),
   };
}

/** Each project's pick in its File it in chooser, by slug: kept outside the
 * row, so a section's one click files every row where its own chooser says
 * (chosenHomes), and a trip away and back keeps it. */
const homePicks = createMemoryStore<{ picks: ReadonlyMap<string, string> }>({ picks: new Map() });

function setHomePick(slug: string, to: string): void {
   homePicks.set({ picks: new Map(homePicks.get().picks).set(slug, to) });
}

/** Forget every pick (tests start clean). */
export function clearHomePicks(): void {
   homePicks.set({ picks: new Map() });
}

/** useHomeChooser's reading, for a row and a pick: what it shows, where it
 * stands, and the filing the next call carries. */
function homeChoice(
   row: DecideRow,
   list: readonly Initiative[],
   items: readonly PortfolioItem[],
   pick: string | null,
   away: boolean
) {
   const asks = row.reasons.some(r => r.kind === 'new' || r.kind === 'unfiled');
   const current = row.slug ? homesOf(list).get(row.slug)?.initiative ?? null : null;
   // `away`: moving it out of the home it has (Track it, Move the project),
   // so it starts on the guess; guessed only where a chooser can show it
   const guess =
      (asks || away) && (!current || away) && row.slug && list.length
         ? guessHome(row.slug, items, list)
         : null;
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

/** What a section's one click does with each row's chooser: the filing it
 * carries (the row's pick, or the board's guess), or `waiting` when the
 * chooser is empty and the row's own answer is off until a pick. */
export function useChosenHomes(): (row: DecideRow) => { waiting: boolean; filed?: Filed } {
   const { initiatives } = useInitiativesValue();
   const items = useContext(AllItemsContext);
   const { picks } = homePicks.useValue();
   return row => {
      const c = homeChoice(
         row,
         initiatives ?? [],
         items,
         row.slug ? picks.get(row.slug) ?? null : null,
         false
      );
      return { waiting: c.shown && !c.chosen, filed: c.filed };
   };
}

/** The chooser's line, above the answers that use it: "File it in [Release
 * safety]", with "guessed" while it shows the board's guess. A select, so
 * the keyboard and a screen reader get the platform's own list. */
export function HomeChooser({
   name,
   chooser,
   autoFocus = false,
   below = false,
   children,
}: {
   name: string;
   chooser: Pick<
      ReturnType<typeof useHomeChooser>,
      'chosen' | 'choices' | 'guessed' | 'setPick' | 'current'
   >;
   /** opened by a click (Track it, Move the project): the focus moves here */
   autoFocus?: boolean;
   /** under the answers that opened it, rather than above the ones it feeds */
   below?: boolean;
   /** the answer it feeds, on its own line (File it) */
   children?: ReactNode;
}) {
   const id = useId();
   // where it is now, so the guess's hover never says Unsorted of a project
   // that's filed
   const now = !chooser.current
      ? `It’s ${UNSORTED_WORD}`
      : chooser.current.kind === 'untracked'
      ? 'It’s Not tracked now'
      : `It’s in ${chooser.current.name} now`;
   return (
      <div
         className={`flex flex-wrap items-center gap-2 text-xs text-ink-3 ${below ? 'mt-2' : 'mb-2'}`}
      >
         <label htmlFor={id} className="w-full sm:w-32 sm:shrink-0">
            {FILE_IT_IN}
         </label>
         <select
            id={id}
            autoFocus={autoFocus}
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
               title={`${now}. This is the initiative its people work in most.`}
            >
               guessed
            </span>
         )}
         {children}
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
           ]
         : primary.kind === 'goal_reached'
         ? [{ call: { kind: 'close', as: 'done' }, words: 'Close as done', suggested: true }]
         : [
              {
                 call: { kind: 'reopen' },
                 words: initiative ? `Reopen ${initiative.name}` : 'Reopen it',
                 suggested: true,
              },
           ];
   // the other answers, after the button that shows them, so a second click
   // there never lands on one
   const extras: Option[] =
      more && primary.kind === 'goal_reached'
         ? [
              { call: { kind: 'close', as: 'dropped' }, words: 'Close as dropped' },
              { call: { kind: 'keep_open' }, words: 'Keep open' },
           ]
         : [];
   const moreWords =
      primary.kind === 'untracked_grew'
         ? 'Track it'
         : primary.kind === 'reopened_in_closed'
         ? 'Move the project'
         : 'Other answers';
   // Track it and Move the project open the chooser under the answers, with
   // its own File button and the focus: the button clicked stays where it
   // was, and nothing that files sits under the pointer. It starts on a
   // guess, never on the home being left
   const moves =
      more && (primary.kind === 'untracked_grew' || primary.kind === 'reopened_in_closed');
   const button = (o: Option, k: number) => {
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
   };
   return (
      <div className="flex flex-col">
         {primary.kind === 'no_project' && (
            <ProjectChooser name={name} value={project} onChange={setProject} />
         )}
         {primary.kind === 'unfiled' && pickable.length > 0 && (
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
            {options.map(button)}
            {primary.kind !== 'unfiled' && primary.kind !== 'no_project' && (
               <button
                  type="button"
                  tabIndex={-1}
                  aria-expanded={more}
                  aria-label={`${moreWords}: ${name}`}
                  onClick={() => setMore(m => !m)}
                  className={`hit pressable inline-flex h-8 items-center rounded-lg border px-3 text-[13px] font-medium hover:border-brand hover:text-brand ${
                     more ? 'border-brand bg-muted text-ink' : 'border-line bg-surface text-ink-2'
                  }`}
               >
                  {moreWords}
               </button>
            )}
            {extras.map((o, k) => button(o, k + 1))}
         </div>
         {moves && pickable.length > 0 && (
            <HomeChooser
               name={name}
               below
               autoFocus
               chooser={{ ...chooser, choices: pickable, chosen: chosen?.slug ?? '' }}
            >
               <button
                  type="button"
                  aria-label={`${fileOption.words}: ${name}`}
                  disabled={!filing}
                  onClick={() => filing && onCall(filing)}
                  className="hit pressable inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 hover:border-brand hover:text-brand disabled:opacity-60"
               >
                  {fileOption.words}
               </button>
            </HomeChooser>
         )}
      </div>
   );
}

/**
 * Decide's Initiative switch, beside the team switch: an owner runs their
 * slice. A select, since there can be twenty; each names how many are owed,
 * and only the ones with something owed are offered (and the one picked):
 * the open homes in rank order, a closed initiative while a project in it
 * is asked about, then Unsorted and No project yet.
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
      // a plan with no project is in no initiative, as its Roadmap lane says
      [NO_PROJECT, NO_PROJECT_YET] as const,
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
