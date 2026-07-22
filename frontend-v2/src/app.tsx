import {
   useCallback,
   useEffect,
   useLayoutEffect,
   useMemo,
   useRef,
   useState,
   type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { ago, closedEpoch, n, pullKey, shortRepo } from './format';
import type { ActionStateKey } from './model/actions';
import { actionState } from './model/actions';
import type { DerivedPull } from './model/status';
import { matchesWeightFilter } from './model/status';
import { buildParentLookup } from './model/stack';
import { buildReviewerPools, turnFor } from './model/rotation';
import { shipRelevance, shippedToast } from './model/shipped';
import type { Toast } from './model/toast';
import type { Team as TeamGroup } from './types';
import { claimReview, isSnoozed, markAllSeen, setWeightLabels, usePulldasher } from './store';
import { applyLegacyFilters, describeLegacyView, readLegacyView } from './legacy';
import { loadSiteConfig, primeScope, useScope } from './prefs';
import { getSettings, useSettings } from './settings';
import { useNotifications } from './notifications';
import { ToastStack, useToasts } from './toasts';
import { matchesQuery } from './model/query';
import { CRYO_KEY, isBotLogin, personHidden, repoHidden } from './model/visibility';
import { reviewRequestedFrom } from './model/reviewers';
import { foldDomId, openFold } from './components/Lane';
import { Icon } from './components/Icon';
import { Legend } from './components/Legend';
import { Logo } from './components/Logo';
import { NotificationPanel } from './components/NotificationPanel';
import { RepoFilter } from './components/filters/RepoFilter';
import { PeopleFilter } from './components/filters/PeopleFilter';
import { WeightFilter } from './components/filters/WeightFilter';
import { StateFilter } from './components/filters/StateFilter';
import { HiddenPanel } from './components/filters/HiddenPanel';
import { hasActiveFilters } from './components/filters/shared';
import { SavedFiltersInput, SavedFiltersMenu } from './components/SavedFiltersPanel';
import type { RowOptions } from './components/Row';
import { Review } from './views/Review';
import { MyWork } from './views/MyWork';
import { People } from './views/People';
import { Team } from './views/Team';
import { Classic } from './views/Classic';
import { Ci } from './views/Ci';
import { Stats } from './views/Stats';
import { Settings } from './components/Settings';

type Lens = 'review' | 'mine' | 'team' | 'people' | 'classic' | 'ci' | 'stats';

const LENSES: Lens[] = ['review', 'mine', 'team', 'people', 'classic', 'ci', 'stats'];

/** every actionState bucket, for validating the `state=` hash param against */
const ACTION_STATE_KEYS: ActionStateKey[] = [
   'restamp',
   'review',
   'qa',
   'mine',
   'blocked',
   'waiting',
];

/**
 * The whole view lives in the hash — lens, drill-downs, query, scope,
 * toggles — so any board is pasteable and a bookmark is a saved view
 * (v1's superpower, restored). Defaults are omitted, so a plain /v2/ URL
 * stays plain.
 */
interface HashState {
   lens: Lens;
   person: string | null;
   team: string | null;
   q: string;
   repos: string[];
   authors: string[];
   /** review-effort classes to narrow to: 'xs'..'xl' or 'unknown' */
   weight: string[];
   /** actionState buckets to narrow to (model/actions.ts) */
   state: ActionStateKey[];
   /** master reveal: show every off-by-default PR */
   hidden: boolean;
   /** individually revealed hidden groups: repo names and the cryo sentinel */
   reveal: string[];
   /** session override of the drafts default (null = use the durable default) */
   drafts: 'mine' | 'all' | null;
}

/**
 * The lens a bare hash (no `lens=` param) resolves to — the single source of
 * truth both readHash's fallback and buildHash's omission rule must agree on.
 * buildHash used to compare against a hardcoded 'review' while this fallback
 * tracked the user's configured default: with any other default, clicking
 * Review wrote a lens-less hash, the hashchange listener re-read it via this
 * same fallback, and the board snapped back to the configured default.
 */
function defaultLensFallback(): Lens {
   const preferred = getSettings().defaultLens as Lens;
   return LENSES.includes(preferred) ? preferred : ('review' as Lens);
}

function readHash(): HashState {
   const p = new URLSearchParams(location.hash.slice(1));
   let lens = p.get('lens') as Lens | null;
   // the Board lens merged into Classic (same columns, real justification);
   // old #lens=board links keep working
   if ((lens as string) === 'board') lens = 'classic';
   // a bare URL (no lens param) opens the user's configured default view
   const fallback = defaultLensFallback();
   return {
      lens: lens && LENSES.includes(lens) ? lens : fallback,
      person: p.get('person'),
      team: p.get('team'),
      q: p.get('q') ?? '',
      repos: p.get('repos')?.split(',').filter(Boolean) ?? [],
      authors: p.get('authors')?.split(',').filter(Boolean) ?? [],
      weight: p.get('weight')?.split(',').filter(Boolean) ?? [],
      state: (p.get('state')?.split(',').filter(Boolean) ?? []).filter((s): s is ActionStateKey =>
         ACTION_STATE_KEYS.includes(s as ActionStateKey)
      ),
      hidden: p.get('hidden') === '1',
      reveal: p.get('show')?.split(',').filter(Boolean) ?? [],
      drafts: p.get('drafts') === 'all' ? 'all' : p.get('drafts') === 'mine' ? 'mine' : null,
   };
}

function buildHash(s: HashState): string {
   const p = new URLSearchParams();
   if (s.lens !== defaultLensFallback()) p.set('lens', s.lens);
   if (s.person) p.set('person', s.person);
   if (s.team) p.set('team', s.team);
   if (s.q) p.set('q', s.q);
   if (s.repos.length) p.set('repos', s.repos.join(','));
   if (s.authors.length) p.set('authors', s.authors.join(','));
   if (s.weight.length) p.set('weight', s.weight.join(','));
   if (s.state.length) p.set('state', s.state.join(','));
   if (s.hidden) p.set('hidden', '1');
   if (s.reveal.length) p.set('show', s.reveal.join(','));
   if (s.drafts) p.set('drafts', s.drafts);
   return p.toString();
}

// A shared link's scope applies for the session without touching the
// visitor's saved scope; their own edits still persist as usual.
const urlState = readHash();
if (urlState.repos.length || urlState.authors.length) {
   primeScope({ repos: urlState.repos, authors: urlState.authors });
}

/** Full-width notice under the header: bad = red alert, warn = amber, brand = informational. */
function Banner({
   tone,
   onClick,
   ariaLabel,
   children,
}: {
   tone: 'bad' | 'warn' | 'brand';
   /** present only when the banner has somewhere useful to send the click —
    * renders it as a real button instead of a static strip */
   onClick?: () => void;
   ariaLabel?: string;
   children: ReactNode;
}) {
   const inner: Record<typeof tone, string> = {
      bad: 'border-bad bg-surface text-bad',
      warn: 'border-warn bg-surface',
      brand: 'notice-inner border-brand bg-brand-50 text-brand-700',
   };
   const surface = `flex w-full items-center gap-2 rounded-lg border px-3 py-[7px] text-left ${inner[tone]} ${
      onClick ? 'pressable hover:bg-brand-100' : ''
   }`;
   return (
      <div className="mx-auto mt-3 max-w-[1240px] px-5 text-[13px]">
         {onClick ? (
            <button type="button" onClick={onClick} aria-label={ariaLabel} className={surface}>
               {children}
            </button>
         ) : (
            <div className={surface} role={tone === 'brand' ? undefined : 'alert'}>
               {children}
            </div>
         )}
      </div>
   );
}

/** Header pill toggle: brand-tinted while active, quiet outline otherwise. */
function ToggleChip({
   active,
   onClick,
   title,
   className = '',
   children,
}: {
   active: boolean;
   onClick: () => void;
   title?: string;
   className?: string;
   children: ReactNode;
}) {
   return (
      <button
         type="button"
         onClick={onClick}
         title={title}
         className={`pressable inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium ${
            active
               ? 'border-brand bg-brand-50 text-brand-700'
               : 'border-line bg-surface text-ink-3 hover:text-brand'
         } ${className}`}
      >
         {children}
      </button>
   );
}

export function App() {
   const {
      pulls,
      closed,
      repoSpecs,
      me,
      connection,
      initialized,
      authFailed,
      lastPayloadAt,
      lastSeen,
      acked,
      snoozed,
      refreshProgress,
   } = usePulldasher();
   // desktop notifications watch the whole board, not the current filter
   useNotifications(pulls, me, initialized);
   const [scope, setScope] = useScope();
   // a v1 bookmark (?repo=…&author=…&cryo=1…) opens Classic configured the
   // same way; the chip below shows what it applied and dismisses it
   const [legacy, setLegacy] = useState(() => readLegacyView(location.search));
   const [lens, setLens] = useState<Lens>(() => {
      const h = readHash();
      if (legacy && !location.hash.includes('lens=')) return 'classic';
      return h.lens;
   });
   const [person, setPerson] = useState<string | null>(() => urlState.person);
   const [team, setTeam] = useState<string | null>(() => urlState.team);
   const [query, setQuery] = useState(() => urlState.q);
   // narrows the board to one or more review-effort classes ('xs'..'xl',
   // 'unknown'); empty = no filter
   const [weightSel, setWeightSel] = useState<string[]>(() => urlState.weight);
   // narrows the board to one or more actionState buckets; empty = no filter
   const [stateSel, setStateSel] = useState<ActionStateKey[]>(() => urlState.state);
   // "hidden" is two off-by-default groups (Cryogenic-Storage PRs, quiet
   // repos). showAll reveals both; reveal names individual groups to show.
   const [showAll, setShowAll] = useState(
      () => urlState.hidden || (!!legacy && (legacy.cryo || legacy.showAllRepos))
   );
   const [reveal, setReveal] = useState<string[]>(() => urlState.reveal);
   const toggleReveal = useCallback(
      (key: string) =>
         setReveal(cur => (cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key])),
      []
   );
   // drafts is a session override of the durable default; null-in-URL uses it
   const [draftsMode, setDraftsMode] = useState<'mine' | 'all'>(
      () => urlState.drafts ?? getSettings().draftsMode
   );
   const [teams, setTeams] = useState<TeamGroup[]>([]);
   const [extraBots, setExtraBots] = useState<ReadonlySet<string>>(new Set());
   const isBot = useCallback(
      (p: DerivedPull) => isBotLogin(p.data.user.login, extraBots),
      [extraBots]
   );
   // theme, density, default view, age colors, glance guard — all live in
   // settings now (the cog panel), persisted per-browser
   const settings = useSettings();
   // your personal team merges into the org's config.json teams, leading the
   // list — it's the one a viewer actually picked, not a standing org fixture
   const allTeams = useMemo(
      () =>
         settings.myTeam.length
            ? [{ team: 'Your team', members: settings.myTeam }, ...teams]
            : teams,
      [teams, settings.myTeam]
   );
   const [systemDark, setSystemDark] = useState(
      () => matchMedia('(prefers-color-scheme: dark)').matches
   );
   const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark);
   const searchRef = useRef<HTMLInputElement>(null);

   useEffect(() => {
      void loadSiteConfig().then(c => {
         setExtraBots(new Set(c.bots));
         setTeams(c.teams);
         setWeightLabels(c.weightLabels);
      });
   }, []);
   // View changes (lens, person, team) earn a history entry so the back
   // button navigates between boards; filter tweaks replace in place so
   // typing a query doesn't bury history under keystrokes.
   const prevView = useRef({ lens, person, team });
   useEffect(() => {
      const next = buildHash({
         lens,
         person,
         team,
         q: query,
         repos: scope.repos,
         authors: scope.authors,
         weight: weightSel,
         state: stateSel,
         hidden: showAll,
         reveal,
         drafts: draftsMode !== settings.draftsMode ? draftsMode : null,
      });
      if (next === location.hash.slice(1)) return;
      const prev = prevView.current;
      prevView.current = { lens, person, team };
      if (prev.lens !== lens || prev.person !== person || prev.team !== team) {
         // fires hashchange; the listener below re-reads idempotently
         location.hash = next;
      } else {
         history.replaceState(null, '', next ? `#${next}` : location.pathname + location.search);
      }
   }, [
      lens,
      person,
      team,
      query,
      scope,
      weightSel,
      stateSel,
      showAll,
      reveal,
      draftsMode,
      settings.draftsMode,
      settings.defaultLens,
   ]);
   useEffect(() => {
      const onHash = () => {
         const h = readHash();
         setLens(h.lens);
         setPerson(h.person);
         setTeam(h.team);
         setQuery(h.q);
         setWeightSel(h.weight);
         setStateSel(h.state);
         setShowAll(h.hidden);
         setReveal(h.reveal);
         setDraftsMode(h.drafts ?? getSettings().draftsMode);
      };
      window.addEventListener('hashchange', onHash);
      return () => window.removeEventListener('hashchange', onHash);
   }, []);
   // the entrance settle runs once per visit, not on every tab switch
   const [entrance, setEntrance] = useState(true);
   useEffect(() => {
      const t = setTimeout(() => setEntrance(false), 700);
      return () => clearTimeout(t);
   }, []);
   // lane/section headers stick just below the app header; its height varies
   // (the toolbar wraps on narrow screens), so publish the measured height as
   // --header-h for their sticky offset
   const headerRef = useRef<HTMLElement>(null);
   useLayoutEffect(() => {
      const el = headerRef.current;
      if (!el) return;
      const publish = () =>
         document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`);
      publish();
      const ro = new ResizeObserver(publish);
      ro.observe(el);
      return () => ro.disconnect();
   }, []);
   useEffect(() => {
      document.documentElement.classList.toggle('dark', dark);
   }, [dark]);
   useEffect(() => {
      document.documentElement.dataset.density = settings.density;
   }, [settings.density]);
   // follow the OS live (only visible while theme is 'system')
   useEffect(() => {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const follow = () => setSystemDark(mq.matches);
      mq.addEventListener('change', follow);
      return () => mq.removeEventListener('change', follow);
   }, []);
   // The keyboard model for an audience that lives in editors:
   //   /   jump to the filter box (v1's hotkey)
   //   j/k move focus down/up the rows (Enter opens — it's a link)
   //   c   copy the focused row's branch name
   useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
         if (e.metaKey || e.ctrlKey || e.altKey) return;
         const t = e.target as HTMLElement;
         if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable) return;
         if (e.key === '/') {
            e.preventDefault();
            searchRef.current?.focus();
            searchRef.current?.select();
            return;
         }
         if (e.key === 'j' || e.key === 'k') {
            const links = [
               ...document.querySelectorAll<HTMLAnchorElement>('.pd-row a[href*="/pull/"]'),
            ];
            if (!links.length) return;
            const at = links.indexOf(document.activeElement as HTMLAnchorElement);
            const next =
               at === -1
                  ? e.key === 'j'
                     ? 0
                     : links.length - 1
                  : e.key === 'j'
                    ? Math.min(at + 1, links.length - 1)
                    : Math.max(at - 1, 0);
            links[next]?.focus();
            e.preventDefault();
            return;
         }
         if (e.key === 'c') {
            const row = (document.activeElement as HTMLElement | null)?.closest('.pd-row');
            const copy = row?.querySelector<HTMLButtonElement>('button[aria-label^="copy branch"]');
            copy?.click();
         }
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
   }, []);

   const hiddenRepos = useMemo(
      () => new Set(repoSpecs.filter(s => s.hideByDefault).map(s => s.name)),
      [repoSpecs]
   );

   // scope/query applied, but NOT the changed-only toggle: the changed count
   // must describe the pool the toggle would narrow, or the banner promises
   // rows the click doesn't deliver
   // repos named in the query (repo:x) reveal a muted repo for this session —
   // an explicit filter is an explicit "I want it now"
   const queryRepos = useMemo(
      () => (query ? [...query.matchAll(/repo:(\S+)/gi)].map(m => m[1].toLowerCase()) : []),
      [query]
   );
   const revealedRepo = useCallback(
      (repo: string) =>
         reveal.includes(repo) ||
         scope.repos.includes(repo) ||
         !!legacy?.repos.includes(shortRepo(repo)) ||
         queryRepos.some(q => shortRepo(repo).toLowerCase().includes(q)),
      [reveal, scope.repos, legacy, queryRepos]
   );
   // same idea as queryRepos/revealedRepo, but people have no reveal= list of
   // their own — muting is a plain two-state toggle, so a scope pick or an
   // author: query term is the whole reveal story
   const queryAuthors = useMemo(
      () => (query ? [...query.matchAll(/author:(\S+)/gi)].map(m => m[1].toLowerCase()) : []),
      [query]
   );
   const revealedAuthor = useCallback(
      (login: string) =>
         scope.authors.includes(login) || queryAuthors.some(q => login.toLowerCase().includes(q)),
      [scope.authors, queryAuthors]
   );

   // The one is-this-pull-off-the-board predicate: muted (user) and
   // org-hidden repos, muted people, cryo, snoozes, and the drafts rule stay
   // off unless a session act reveals them — an explicit reveal, a scope, a
   // repo:/author: query term, or the master "show everything". Never hides
   // your own pulls or bots via mutes: bots have their own fold, and a person
   // can't mute themselves off their own board. Shared by the filter pipeline
   // and the hidden-PR ledger's counts so the ledger's number can never
   // disagree with what the board actually withholds.
   const boardHidden = useCallback(
      (p: DerivedPull) => {
         if (showAll) return false;
         const hiddenRepo =
            repoHidden(p.data.repo, hiddenRepos, settings.repoPrefs) && !revealedRepo(p.data.repo);
         const hiddenPerson =
            p.data.user.login !== me &&
            !isBot(p) &&
            personHidden(p.data.user.login, settings.mutedPeople) &&
            !revealedAuthor(p.data.user.login);
         const cryoHidden = p.cryo && !settings.showCryo && !reveal.includes(CRYO_KEY);
         // drafts: 'mine' keeps other people's drafts quiet on the general
         // board, but not when you've deliberately looked (scoped/`author:`d
         // that person) or when GitHub explicitly requested your review — a
         // review-requested draft was vanishing even from the reviewer it was
         // requested from, the reported bug. Your own drafts always show. The
         // legacy path owns its own draft rule, so don't double-apply.
         const draftHidden =
            !legacy &&
            draftsMode === 'mine' &&
            p.data.draft &&
            p.data.user.login !== me &&
            !revealedAuthor(p.data.user.login) &&
            !reviewRequestedFrom(p, me);
         // a snoozed pull stays off the board until tomorrow or its next
         // change; the master reveal shows it like every other hidden group
         return (
            hiddenRepo || hiddenPerson || cryoHidden || draftHidden || isSnoozed(p.data, snoozed)
         );
      },
      [
         showAll,
         reveal,
         revealedRepo,
         revealedAuthor,
         hiddenRepos,
         legacy,
         me,
         isBot,
         settings.repoPrefs,
         settings.showCryo,
         settings.mutedPeople,
         draftsMode,
         snoozed,
      ]
   );

   // every existing scope/query pass, but not yet the Weight/State filters —
   // WeightFilter's live per-option counts read this pool, so narrowing to
   // one weight class doesn't make the other classes' counts vanish (the
   // same reasoning PeopleFilter's authorCounts follows for its own pool)
   const preWeightScoped = useMemo(() => {
      let out = pulls;
      if (legacy) out = applyLegacyFilters(out, legacy, me);
      out = out.filter(p => !boardHidden(p));
      if (scope.repos.length) out = out.filter(p => scope.repos.includes(p.data.repo));
      // bots bypass the people filter on purpose: dependency bumps need review
      // no matter whose work you follow (they land in the bots fold, not lanes)
      if (scope.authors.length)
         out = out.filter(p => isBot(p) || scope.authors.includes(p.data.user.login));
      if (query) out = out.filter(p => matchesQuery(p, query, me));
      return out;
   }, [pulls, legacy, me, boardHidden, scope, isBot, query]);

   // preWeightScoped narrowed by the Weight filter, but not yet State —
   // StateFilter's own live counts read this pool for the same
   // self-vanishing-count reason preWeightScoped exists for WeightFilter
   const preStateScoped = useMemo(
      () =>
         weightSel.length
            ? preWeightScoped.filter(p => matchesWeightFilter(p, weightSel))
            : preWeightScoped,
      [preWeightScoped, weightSel]
   );

   const scoped = useMemo(
      () =>
         stateSel.length
            ? preStateScoped.filter(p => stateSel.includes(actionState(p, me)))
            : preStateScoped,
      [preStateScoped, stateSel, me]
   );

   // memoized so the arrays keep their identity across unrelated re-renders
   // (each keystroke, settings toggle, and heartbeat re-runs App)
   const humans = useMemo(() => scoped.filter(p => !isBot(p)), [scoped, isBot]);
   const bots = useMemo(() => scoped.filter(isBot), [scoped, isBot]);
   // every known repo with its open-PR count — feeds the Filters popover and
   // the Settings repo manager. Includes org-hidden and pref'd repos at 0.
   const repoCounts = useMemo(() => {
      const m = new Map<string, number>();
      for (const name of hiddenRepos) m.set(name, 0);
      for (const name of Object.keys(settings.repoPrefs)) if (!m.has(name)) m.set(name, 0);
      for (const p of pulls) m.set(p.data.repo, (m.get(p.data.repo) ?? 0) + 1);
      return [...m.entries()]
         .map(([name, count]) => ({ name, count }))
         .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
   }, [pulls, hiddenRepos, settings.repoPrefs]);

   // "recently shipped" must follow the same scope as the open lanes above it —
   // narrowing to one repo or author shouldn't still show the whole org's
   // merges. Closed PRs are PullData (no derived cryo/reveal), so apply the
   // durable repo visibility plus the active repo/author scope.
   const scopedClosed = useMemo(() => {
      let out = closed;
      if (!showAll)
         out = out.filter(p => {
            const hiddenRepo =
               repoHidden(p.repo, hiddenRepos, settings.repoPrefs) && !revealedRepo(p.repo);
            const hiddenPerson =
               p.user.login !== me &&
               !isBotLogin(p.user.login, extraBots) &&
               personHidden(p.user.login, settings.mutedPeople) &&
               !revealedAuthor(p.user.login);
            return !hiddenRepo && !hiddenPerson;
         });
      if (scope.repos.length) out = out.filter(p => scope.repos.includes(p.repo));
      if (scope.authors.length) out = out.filter(p => scope.authors.includes(p.user.login));
      return out;
   }, [
      closed,
      showAll,
      hiddenRepos,
      settings.repoPrefs,
      settings.mutedPeople,
      revealedRepo,
      revealedAuthor,
      scope,
      me,
      extraBots,
   ]);

   // the hidden-PR ledger's numbers: stable per-category sizes (what each
   // rule covers, whether or not a session reveal currently shows it) plus
   // the live currently-hidden total for the trigger label
   const hiddenCounts = useMemo(() => {
      const c = { parked: 0, drafts: 0, mutedRepos: 0, mutedPeople: 0, snoozed: 0, hiddenNow: 0 };
      for (const p of pulls) {
         if (p.cryo) c.parked++;
         if (p.data.draft && p.data.user.login !== me && !reviewRequestedFrom(p, me)) c.drafts++;
         if (repoHidden(p.data.repo, hiddenRepos, settings.repoPrefs)) c.mutedRepos++;
         if (
            p.data.user.login !== me &&
            !isBot(p) &&
            personHidden(p.data.user.login, settings.mutedPeople)
         )
            c.mutedPeople++;
         if (isSnoozed(p.data, snoozed)) c.snoozed++;
         if (boardHidden(p)) c.hiddenNow++;
      }
      return c;
   }, [
      pulls,
      me,
      hiddenRepos,
      settings.repoPrefs,
      settings.mutedPeople,
      isBot,
      snoozed,
      boardHidden,
   ]);
   // counts every open pull a snooze currently hides, for the Settings surface
   const snoozedCount = hiddenCounts.snoozed;

   const isScoped = scope.repos.length || scope.authors.length || query;

   // what a "Save current filter…" click right now would capture — the same
   // object the hash-writing effect above builds, so a saved filter's hash
   // always matches what location.hash would read at this moment
   const currentHash = useMemo(
      () =>
         buildHash({
            lens,
            person,
            team,
            q: query,
            repos: scope.repos,
            authors: scope.authors,
            weight: weightSel,
            state: stateSel,
            hidden: showAll,
            reveal,
            drafts: draftsMode !== settings.draftsMode ? draftsMode : null,
         }),
      [
         lens,
         person,
         team,
         query,
         scope,
         weightSel,
         stateSel,
         showAll,
         reveal,
         draftsMode,
         settings.draftsMode,
      ]
   );
   // gates the saved-filters panel's "Save current filter…" row (query box)
   // and its muted hint row (the header "Saved" menu) — one definition
   // (FilterChips.tsx) so the two surfaces can't disagree with FilterChips'
   // own "Clear filters" about what counts as active
   const sessionActive = hasActiveFilters({
      reveal,
      showAll,
      draftsMode,
      defaultDraftsMode: settings.draftsMode,
      scope,
      weightSel,
      stateSel,
   });

   const onPerson = useCallback((login: string) => {
      setPerson(login);
      setTeam(null);
      setLens('people');
   }, []);
   // a row's weight chip toggles that bucket in the session Weight filter —
   // the same array WeightFilter's own checkboxes drive
   const onWeightToggle = useCallback((w: string) => {
      setWeightSel(cur => (cur.includes(w) ? cur.filter(k => k !== w) : [...cur, w]));
   }, []);
   // the whole-board parent lookup for stacked pulls: built once over every
   // pull (not the scoped/filtered view a given lane renders), so a row whose
   // parent got filtered out of ITS list can still name it (see model/stack.ts)
   const parentOf = useMemo(() => buildParentLookup(pulls), [pulls]);
   // per-repo reviewer pool for the turn rotation (model/rotation.ts): built
   // once over the whole board's open pulls, same reasoning as parentOf above
   const pools = useMemo(() => buildReviewerPools(pulls), [pulls]);
   // whose turn each starved, unclaimed pull is — computed once over the whole
   // board (turnFor reads it for the reciprocity signal) so a Row just looks
   // its answer up instead of re-scanning the board per row
   const turns = useMemo(() => {
      const m = new Map<string, string>();
      for (const p of pulls) {
         const who = turnFor(p, pools, pulls);
         if (who) m.set(pullKey(p.data), who);
      }
      return m;
   }, [pulls, pools]);
   // the age baseline is RELATIVE: the board's longest-open pull sets the
   // full track, everything else is a fraction of it — "how long has this
   // waited, relative to what waiting looks like here"
   const maxAgeDays = useMemo(() => pulls.reduce((m, p) => Math.max(m, p.ageDays), 1), [pulls]);
   // stable identity so memo(Row) can skip untouched rows on socket bursts.
   // laneCap resolves per-lens (falling back to the global default) — safe to
   // read the current `lens` here because only one lens's view ever mounts at
   // a time, so rowOpts never has to carry more than one lens' cap at once.
   const rowOpts: RowOptions = useMemo(
      () => ({
         me,
         lastSeen,
         acked,
         onPerson,
         onWeightToggle,
         maxAgeDays,
         ageWarnDays: settings.ageWarnDays,
         ageRotDays: Math.round(settings.ageWarnDays * 2.5),
         compact: settings.density === 'compact',
         laneCap: settings.laneCapByLens[lens] ?? settings.laneCap,
         parentOf,
         pools,
         turns,
      }),
      [
         me,
         lastSeen,
         acked,
         onPerson,
         onWeightToggle,
         maxAgeDays,
         settings.ageWarnDays,
         settings.density,
         settings.laneCap,
         settings.laneCapByLens,
         lens,
         parentOf,
         pools,
         turns,
      ]
   );

   const mineCount = humans.filter(p => p.data.user.login === me).length;
   const tab = (id: Lens, label: string, count?: number) => (
      <button
         type="button"
         aria-current={lens === id ? 'page' : undefined}
         onClick={() => setLens(id)}
         className={`pressable shrink-0 rounded-lg border-0 px-3 py-2 text-sm font-medium whitespace-nowrap ${
            lens === id ? 'bg-secondary text-ink' : 'bg-transparent text-ink-2 hover:text-brand'
         }`}
      >
         {label}
         {count != null && count > 0 && (
            <span className="ml-1.5 text-xs text-ink-3 tabular-nums">{count}</span>
         )}
      </button>
   );

   // The "recently shipped" fold only exists on Review and My work — the
   // other four lenses have nowhere for the shipped-catch-up toast to jump to.
   // Its count must match what that fold will actually render (scopedClosed
   // for Review, self-authored closed for My work), not the raw org-wide
   // closed count, or the toast could promise a jump the fold can't deliver
   // (count 0, fold not rendered at all).
   const shippedFoldId =
      lens === 'review' ? 'review:shipped' : lens === 'mine' ? 'mine:shipped' : null;
   const shippedFoldCount =
      lens === 'review'
         ? scopedClosed.length
         : lens === 'mine'
           ? closed.filter(p => p.user.login === me).length
           : 0;
   // memoized: this feeds the shippedExtras useMemo below, which feeds
   // useToasts' extras effect — a fresh identity every render would re-run
   // that chain on every unrelated keystroke/toggle while on these lenses
   const jumpToShipped = useMemo(
      () =>
         shippedFoldId
            ? () => {
                 const id = shippedFoldId;
                 openFold(id);
                 // openFold's write lands via useSyncExternalStore, so the fold's
                 // `open` attribute (and the height its rows add) commits on the
                 // next paint, not synchronously in this handler — wait a frame so
                 // the scroll lands on the expanded fold, not the collapsed one.
                 requestAnimationFrame(() => {
                    const el = document.getElementById(foldDomId(id));
                    if (!el) return;
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    el.classList.add('fold-flash');
                    setTimeout(() => el.classList.remove('fold-flash'), 900);
                 });
              }
            : undefined,
      [shippedFoldId]
   );

   // the "shipped while you were away" catch-up, now a single info toast instead
   // of a standing banner. Scope-filtered (respects the active repo/author/hidden
   // filters via scopedClosed) and relevance-gated inside shippedToast (yours or
   // reviewed only) so an org merge you never touched never interrupts. Suppressed
   // entirely while a text query is active — you're searching, don't distract.
   const shippedExtras = useMemo<Toast[]>(() => {
      if (query) return [];
      const backlog = scopedClosed.filter(
         p => (closedEpoch(p) || 0) > lastSeen && shipRelevance(p, me) !== null
      );
      const base = shippedToast(backlog, me);
      if (!base) return [];
      const jump = shippedFoldCount > 0 ? jumpToShipped : undefined;
      return [
         {
            ...base,
            onAct: () => {
               jump?.();
               markAllSeen();
            },
            onGone: markAllSeen,
         },
      ];
   }, [query, scopedClosed, lastSeen, me, jumpToShipped, shippedFoldCount]);

   // the quick-wins toast filters the board to the small reviewable ones on the
   // review lens, instead of scrolling to just the first of the batch
   const onQuickWins = useCallback(() => {
      setLens('review');
      setWeightSel(['XS', 'S']);
   }, []);
   // the "your turn" toast's Claim button: claim the review straight from the
   // nudge (which also adds you as a GitHub reviewer, same as any claim)
   const onClaimTurn = useCallback(
      (repo: string, number: number) => {
         const p = pulls.find(x => x.data.repo === repo && x.data.number === number);
         if (p) claimReview(p.data);
      },
      [pulls]
   );
   const {
      toasts,
      dismiss: dismissToast,
      history: toastHistory,
      clearHistory,
      dismissHistoryItem,
   } = useToasts(pulls, me, shippedExtras, closed, onQuickWins, onClaimTurn, initialized);

   return (
      <>
         <ToastStack toasts={toasts} onDismiss={dismissToast} />
         <header ref={headerRef} className="sticky top-0 z-10 border-b border-line bg-surface">
            {/* Logo + lenses share one line. The logo and the right-hand
                controls both float out past the centered content into the
                gutters — but only as far as a 1536px cap, so an ultrawide
                display parks them a fixed ~150px outside the content instead of
                flinging them to the screen edges. The wordmark collapses to the
                mark, and the open-count / v1 link hide, once the gutter is too
                tight (below 2xl); the tabs reserve pl/pr for the floats below
                that so nothing collides. The floats carry z-[1] so they stay
                clickable over the tab row's own box. */}
            <div className="relative mx-auto max-w-[1536px]">
               {/* the page's one h1 — heading navigation needs a root, and
                   every lane h2 needs a parent level */}
               <h1 className="absolute inset-y-0 left-4 z-[1] m-0 flex items-center gap-1.5 text-base font-semibold tracking-tight">
                  <Logo size={22} className="text-brand" />
                  <span className="hidden 2xl:inline">
                     pull<em className="text-brand not-italic">dasher</em>
                  </span>
               </h1>
               {/* inset-y-0 + items-center for vertical centering, NOT
                   -translate-y-1/2: a transform on this ancestor would re-base
                   position:fixed for the Settings drawer / popovers rendered
                   under it, leaving them mispositioned (invisible). */}
               <div className="absolute inset-y-0 right-4 z-[1] flex items-center gap-x-3.5">
                  {refreshProgress && (
                     // no spinner, no color — the changing number is the motion,
                     // same wording Settings' Data group shows for the same state
                     <span className="hidden text-xs text-ink-3 tabular-nums sm:inline">
                        {refreshProgress.done === refreshProgress.total
                           ? `refreshed ${refreshProgress.total}`
                           : `refreshing ${refreshProgress.done} of ${refreshProgress.total}`}
                     </span>
                  )}
                  <span
                     role="status"
                     className={`h-[7px] w-[7px] flex-none rounded-full ${
                        connection === 'connected'
                           ? 'conn-live bg-ok'
                           : connection === 'connecting'
                             ? // in-progress, not an alarm — the same slate hue CI
                               // running wears, not warn (which means "you owe
                               // something")
                               'bg-slate'
                             : 'bg-bad'
                     }`}
                     title={connection}
                  >
                     <span className="sr-only">live updates {connection}</span>
                  </span>
                  <span className="hidden text-xs text-ink-3 tabular-nums 2xl:inline">
                     <b className="text-ink">
                        {isScoped ? `${scoped.length} of ${pulls.length}` : pulls.length}
                     </b>{' '}
                     open
                  </span>
                  <a
                     href="/v1"
                     className="hidden text-xs text-ink-3 transition-colors duration-150 ease-out hover:text-brand motion-reduce:transition-none 2xl:inline"
                     title="the classic board"
                  >
                     v1 board
                  </a>
                  <NotificationPanel
                     records={toastHistory}
                     onClear={clearHistory}
                     onDismiss={dismissHistoryItem}
                  />
                  {/* the symbol legend is a reference, not an action — drop it
                      on phones to give the header controls their room back */}
                  <span className="hidden sm:flex">
                     <Legend />
                  </span>
                  <Settings snoozedCount={snoozedCount} onGoToTeam={() => setLens('team')} />
               </div>
               <div className="mx-auto flex max-w-[1240px] min-w-0 items-center px-5 py-2.5 pl-11 pr-32 sm:pr-40 2xl:px-5">
                  {/* min-w-0 + overflow-x-auto (no-scrollbar in styles.css)
                      turns a too-narrow tab strip into a swipe rather than a
                      wrap ("My work 5" splitting) or a page-widening overflow. */}
                  <nav className="no-scrollbar flex min-w-0 shrink gap-1 overflow-x-auto">
                     {tab('review', 'Review')}
                     {tab('mine', 'My work', mineCount)}
                     {tab('team', 'Team')}
                     {tab('people', 'People')}
                     {tab('classic', 'Classic')}
                     {tab('ci', 'CI')}
                     {tab('stats', 'Stats')}
                  </nav>
               </div>
            </div>
            <div className="mx-auto flex max-w-[1240px] min-w-0 flex-wrap items-center gap-2 border-t border-secondary px-5 py-2">
               <RepoFilter
                  repos={repoCounts}
                  orgHidden={hiddenRepos}
                  reveal={reveal}
                  toggleReveal={toggleReveal}
                  showAll={showAll}
                  setShowAll={setShowAll}
                  scope={scope}
                  setScope={setScope}
               />
               <PeopleFilter pulls={pulls} teams={allTeams} scope={scope} setScope={setScope} />
               <WeightFilter
                  pulls={preWeightScoped}
                  weightSel={weightSel}
                  setWeightSel={setWeightSel}
               />
               <StateFilter pulls={preStateScoped} stateSel={stateSel} setStateSel={setStateSel} />
               <SavedFiltersMenu sessionActive={sessionActive} />
               <HiddenPanel
                  counts={hiddenCounts}
                  showAll={showAll}
                  setShowAll={setShowAll}
                  reveal={reveal}
                  toggleReveal={toggleReveal}
                  draftsMode={draftsMode}
                  setDraftsMode={setDraftsMode}
               />
               {sessionActive && (
                  <button
                     type="button"
                     onClick={() => {
                        setScope({ repos: [], authors: [] });
                        setWeightSel([]);
                        setStateSel([]);
                        setShowAll(false);
                        setReveal([]);
                        setDraftsMode(settings.draftsMode);
                     }}
                     title="clears scope and session toggles; mutes and stars stay"
                     className="hit pressable rounded-md px-1.5 py-1 text-[13px] text-ink-3 hover:text-brand"
                  >
                     Reset
                  </button>
               )}
               {legacy && (
                  <ToggleChip
                     active
                     onClick={() => setLegacy(null)}
                     title={`filters from your v1 bookmark: ${describeLegacyView(legacy) || 'defaults'}. Click to drop them`}
                     className="max-w-[260px]"
                  >
                     <span className="truncate">
                        v1 view: {describeLegacyView(legacy) || 'defaults'}
                     </span>
                     <Icon icon={X} size={12} />
                  </ToggleChip>
               )}
               <span className="flex-1" />
               {bots.length > 0 && (
                  <span className="text-xs text-ink-3 tabular-nums">
                     {n(bots.length, 'bot PR')}
                  </span>
               )}
               <SavedFiltersInput
                  query={query}
                  setQuery={setQuery}
                  inputRef={searchRef}
                  currentHash={currentHash}
                  sessionActive={sessionActive}
                  inputProps={{
                     'aria-label':
                        'Filter PRs: text, #number, label:x, status:x, older:5, repo:x, author:x, weight:xs, has:action, is:restamp, is:blocked',
                     placeholder: 'Filter (press /)',
                     title: 'text, #number, label:x, status:x, older:5, repo:x, author:x, weight:xs, has:action, is:restamp, is:blocked',
                     className:
                        'h-8 w-[210px] max-w-full grow rounded-lg border border-line bg-surface pr-2.5 pl-8 text-[13px] sm:grow-0',
                  }}
               />
            </div>
         </header>

         {authFailed && (
            <Banner tone="bad">
               <span className="font-semibold">Sign-in failed.</span>
               <span className="text-ink-2">
                  Your session may have expired.{' '}
                  <a href="/" className="font-semibold underline">
                     Reload to sign in again
                  </a>
                  .
               </span>
            </Banner>
         )}
         {initialized && (connection === 'disconnected' || connection === 'error') && (
            <Banner tone="warn">
               <span className="font-semibold text-warn">Live updates lost.</span>
               <span className="text-ink-2">
                  Showing data as of {lastPayloadAt ? `${ago(lastPayloadAt)} ago` : 'page load'},
                  retrying in the background.
               </span>
            </Banner>
         )}
         <main
            className={`mx-auto mt-4 max-w-[1240px] px-5 pb-16 ${entrance ? 'settle-once' : ''}`}
         >
            {!initialized && !authFailed && (
               <div className="flex flex-col items-center gap-2 py-20 text-ink-3" role="status">
                  <span className="conn-live inline-block h-2.5 w-2.5 rounded-full bg-brand" />
                  <span className="text-sm">Loading the board…</span>
               </div>
            )}
            {initialized && lens === 'review' && (
               <Review pulls={humans} bots={bots} closed={scopedClosed} opts={rowOpts} />
            )}
            {initialized && lens === 'mine' && (
               <MyWork pulls={humans} closed={closed} opts={rowOpts} />
            )}
            {initialized && lens === 'team' && (
               <Team
                  pulls={humans}
                  allPulls={pulls.filter(p => !isBot(p))}
                  me={me}
                  opts={rowOpts}
                  onPerson={onPerson}
                  extraBots={extraBots}
               />
            )}
            {initialized && lens === 'people' && (
               <People
                  pulls={humans}
                  allPulls={pulls.filter(p => !isBot(p))}
                  teams={allTeams}
                  person={person}
                  team={team}
                  onPerson={login => {
                     setPerson(login);
                     setTeam(null);
                  }}
                  onTeam={name => {
                     setTeam(name);
                     setPerson(null);
                  }}
                  opts={rowOpts}
               />
            )}
            {initialized && lens === 'classic' && (
               <Classic
                  pulls={scoped}
                  opts={rowOpts}
                  collapsed={legacy?.collapsed}
                  closed={legacy?.closed ? closed : null}
               />
            )}
            {initialized && lens === 'ci' && <Ci pulls={scoped} opts={rowOpts} />}
            {initialized && lens === 'stats' && (
               <Stats pulls={humans} closed={closed} me={me} onPerson={onPerson} />
            )}
         </main>
      </>
   );
}
