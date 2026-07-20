import type { ActionStateKey } from '../../model/actions';
import { CRYO_KEY } from '../../model/visibility';
import { useSettings } from '../../settings';

interface Pill {
   key: string;
   label: string;
   /** clears just this dimension */
   onClear: () => void;
}

interface ActiveFilterArgs {
   reveal: string[];
   showAll: boolean;
   draftsMode: 'mine' | 'all';
   defaultDraftsMode: 'mine' | 'all';
   scope: { repos: string[]; authors: string[] };
   weightSel: string[];
   stateSel: ActionStateKey[];
}

/**
 * Whether any TRANSIENT session filter is narrowing the board right now —
 * what "Clear filters" below would reset, and what the saved-filters panel
 * (SavedFiltersPanel.tsx) reads to decide whether there's anything worth
 * bookmarking. One definition so the two surfaces can't disagree about what
 * counts as "active".
 */
export function hasActiveFilters({
   reveal,
   showAll,
   draftsMode,
   defaultDraftsMode,
   scope,
   weightSel,
   stateSel,
}: ActiveFilterArgs): boolean {
   return (
      scope.repos.length > 0 ||
      scope.authors.length > 0 ||
      weightSel.length > 0 ||
      stateSel.length > 0 ||
      reveal.length > 0 ||
      showAll ||
      draftsMode !== defaultDraftsMode
   );
}

/**
 * The header's chip row: one dismissible pill per ACTIVE session filter
 * dimension, not per item — "3 people" reads at a glance where three separate
 * name chips didn't. Durable state (mutes, stars) gets no chip: the Repos and
 * People triggers already carry those counts in their own active labels, so a
 * chip would just repeat the button next to it.
 */
export function FilterChips({
   reveal,
   toggleReveal,
   showAll,
   setShowAll,
   draftsMode,
   setDraftsMode,
   scope,
   setScope,
   weightSel,
   setWeightSel,
   stateSel,
   setStateSel,
}: {
   reveal: string[];
   toggleReveal: (key: string) => void;
   showAll: boolean;
   setShowAll: (next: boolean) => void;
   draftsMode: 'mine' | 'all';
   setDraftsMode: (m: 'mine' | 'all') => void;
   scope: { repos: string[]; authors: string[] };
   setScope: (next: { repos: string[]; authors: string[] }) => void;
   weightSel: string[];
   setWeightSel: (next: string[]) => void;
   stateSel: ActionStateKey[];
   setStateSel: (next: ActionStateKey[]) => void;
}) {
   const settings = useSettings();
   // an individually-revealed repo/cryo, outside full showAll — "hidden shown"
   // covers both; cryo gets its own pill only when it's revealed on its own
   // (showAll already says "everything," so a second cryo pill would be noise)
   const revealedRepoCount = reveal.filter(k => k !== CRYO_KEY).length;
   const cryoRevealedAlone = !showAll && reveal.includes(CRYO_KEY);

   const pills: Pill[] = [];
   if (scope.repos.length)
      pills.push({
         key: 'repos',
         label: `${scope.repos.length} repo${scope.repos.length > 1 ? 's' : ''}`,
         onClear: () => setScope({ ...scope, repos: [] }),
      });
   if (scope.authors.length)
      pills.push({
         key: 'people',
         label: `${scope.authors.length} ${scope.authors.length > 1 ? 'people' : 'person'}`,
         onClear: () => setScope({ ...scope, authors: [] }),
      });
   if (weightSel.length)
      pills.push({
         key: 'weight',
         label: `weight: ${weightSel.join(', ')}`,
         onClear: () => setWeightSel([]),
      });
   // a single selection spells itself out (matches StateFilter's own trigger
   // label); more than one collapses to "first +N" so the pill can't grow as
   // long as the option labels themselves
   if (stateSel.length)
      pills.push({
         key: 'state',
         label:
            stateSel.length === 1
               ? `state: ${stateSel[0]}`
               : `state: ${stateSel[0]} +${stateSel.length - 1}`,
         onClear: () => setStateSel([]),
      });
   if (draftsMode === 'all' && draftsMode !== settings.draftsMode)
      pills.push({
         key: 'drafts',
         label: 'drafts: all',
         onClear: () => setDraftsMode(settings.draftsMode),
      });
   if (showAll || revealedRepoCount > 0)
      pills.push({
         key: 'hidden',
         label: 'hidden shown',
         onClear: () => {
            setShowAll(false);
            for (const k of reveal) if (k !== CRYO_KEY) toggleReveal(k);
         },
      });
   if (cryoRevealedAlone)
      pills.push({ key: 'cryo', label: 'cryo shown', onClear: () => toggleReveal(CRYO_KEY) });

   // what "Clear" would change — the transient filters, not your durable
   // mutes and stars (those are your board; unmute/unstar them in the list)
   const clearable = hasActiveFilters({
      reveal,
      showAll,
      draftsMode,
      defaultDraftsMode: settings.draftsMode,
      scope,
      weightSel,
      stateSel,
   });

   const clearAll = () => {
      setScope({ repos: [], authors: [] });
      setWeightSel([]);
      setStateSel([]);
      setShowAll(false);
      setDraftsMode(settings.draftsMode);
      for (const k of reveal) toggleReveal(k);
   };

   if (!pills.length && !clearable) return null;

   return (
      <div className="flex flex-wrap items-center gap-1.5">
         {pills.map(p => (
            <span
               key={p.key}
               className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface py-1 pr-1 pl-2 text-xs text-ink-2"
            >
               {p.label}
               <button
                  type="button"
                  onClick={p.onClear}
                  aria-label={`clear ${p.label}`}
                  className="hit pressable rounded px-1 text-ink-3 hover:text-brand"
               >
                  ✕
               </button>
            </span>
         ))}
         {clearable && (
            <button
               type="button"
               onClick={clearAll}
               title="clears scope and session toggles — mutes and stars stay"
               className="hit text-xs font-medium text-brand hover:underline"
            >
               Clear filters
            </button>
         )}
      </div>
   );
}
