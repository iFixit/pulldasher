import { CRYO_KEY, repoState } from '../../model/visibility';
import { useSettings } from '../../settings';

interface Pill {
   key: string;
   label: string;
   /** dismissible = a session/scope narrowing; its × clears just that
    * dimension. Non-dismissible = a durable mute count; clicking it opens
    * the filter popover where the mutes actually live (no × — you don't
    * "clear" a mute from here, you go unmute the rows you want back). */
   onClear?: () => void;
   onOpen?: () => void;
}

/**
 * The header's chip row: one pill per ACTIVE filter dimension, not per item —
 * "3 people" reads at a glance where three separate name chips didn't. Scope
 * and session pills are dismissible (×, clears just that dimension); the
 * muted-repos/muted-people pills are informational buttons that open the
 * matching filter instead, because mutes are durable board state, not
 * something a header chip should silently wipe out.
 */
export function FilterChips({
   repos,
   orgHidden,
   reveal,
   toggleReveal,
   showAll,
   setShowAll,
   draftsMode,
   setDraftsMode,
   scope,
   setScope,
   onOpenRepoFilter,
   onOpenPeopleFilter,
}: {
   repos: { name: string; count: number }[];
   orgHidden: ReadonlySet<string>;
   reveal: string[];
   toggleReveal: (key: string) => void;
   showAll: boolean;
   setShowAll: (next: boolean) => void;
   draftsMode: 'mine' | 'all';
   setDraftsMode: (m: 'mine' | 'all') => void;
   scope: { repos: string[]; authors: string[] };
   setScope: (next: { repos: string[]; authors: string[] }) => void;
   onOpenRepoFilter: () => void;
   onOpenPeopleFilter: () => void;
}) {
   const settings = useSettings();
   const mutedRepoCount = repos.filter(
      r => repoState(r.name, orgHidden, settings.repoPrefs) === 'muted'
   ).length;
   const mutedPeopleCount = settings.mutedPeople.length;
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
   if (mutedRepoCount)
      pills.push({
         key: 'muted-repos',
         label: `${mutedRepoCount} muted repo${mutedRepoCount > 1 ? 's' : ''}`,
         onOpen: onOpenRepoFilter,
      });
   if (mutedPeopleCount)
      pills.push({
         key: 'muted-people',
         label: `${mutedPeopleCount} muted ${mutedPeopleCount > 1 ? 'people' : 'person'}`,
         onOpen: onOpenPeopleFilter,
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
   const clearable =
      scope.repos.length > 0 ||
      scope.authors.length > 0 ||
      reveal.length > 0 ||
      showAll ||
      draftsMode !== settings.draftsMode;

   const clearAll = () => {
      setScope({ repos: [], authors: [] });
      setShowAll(false);
      setDraftsMode(settings.draftsMode);
      for (const k of reveal) toggleReveal(k);
   };

   if (!pills.length && !clearable) return null;

   return (
      <div className="flex flex-wrap items-center gap-1.5">
         {pills.map(p =>
            p.onClear ? (
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
            ) : (
               <button
                  key={p.key}
                  type="button"
                  onClick={p.onOpen}
                  title={`open the ${p.key === 'muted-repos' ? 'repos' : 'people'} filter`}
                  className="pressable rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink-2 hover:border-brand hover:text-brand"
               >
                  {p.label}
               </button>
            )
         )}
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
