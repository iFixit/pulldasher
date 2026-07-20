import {
   useCallback,
   useEffect,
   useLayoutEffect,
   useMemo,
   useRef,
   useState,
   type ReactNode,
} from 'react';
import { ago, epoch, n, shortRepo } from './format';
import type { DerivedPull } from './model/status';
import type { Team as TeamGroup } from './types';
import { isSnoozed, setWeightLabels, usePulldasher } from './store';
import { applyLegacyFilters, describeLegacyView, readLegacyView } from './legacy';
import { loadSiteConfig, primeScope, useScope } from './prefs';
import { getSettings, useSettings } from './settings';
import { useNotifications } from './notifications';
import { matchesQuery } from './model/query';
import { CRYO_KEY, isBotLogin, personHidden, repoHidden } from './model/visibility';
import { Legend } from './components/Legend';
import { RepoFilter } from './components/filters/RepoFilter';
import { PeopleFilter } from './components/filters/PeopleFilter';
import { FilterChips } from './components/filters/FilterChips';
import type { RowOptions } from './components/Row';
import { Review } from './views/Review';
import { MyWork } from './views/MyWork';
import { People } from './views/People';
import { Team } from './views/Team';
import { Classic } from './views/Classic';
import { Stats } from './views/Stats';
import { Settings } from './components/Settings';

type Lens = 'review' | 'mine' | 'team' | 'people' | 'classic' | 'stats';

const LENSES: Lens[] = ['review', 'mine', 'team', 'people', 'classic', 'stats'];

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
   /** master reveal: show every off-by-default PR */
   hidden: boolean;
   /** individually revealed hidden groups: repo names and the cryo sentinel */
   reveal: string[];
   /** session override of the drafts default (null = use the durable default) */
   drafts: 'mine' | 'all' | null;
}

function readHash(): HashState {
   const p = new URLSearchParams(location.hash.slice(1));
   let lens = p.get('lens') as Lens | null;
   // the Board lens merged into Classic (same columns, real justification);
   // old #lens=board links keep working
   if ((lens as string) === 'board') lens = 'classic';
   // a bare URL (no lens param) opens the user's configured default view
   const preferred = getSettings().defaultLens as Lens;
   const fallback = LENSES.includes(preferred) ? preferred : ('review' as Lens);
   return {
      lens: lens && LENSES.includes(lens) ? lens : fallback,
      person: p.get('person'),
      team: p.get('team'),
      q: p.get('q') ?? '',
      repos: p.get('repos')?.split(',').filter(Boolean) ?? [],
      authors: p.get('authors')?.split(',').filter(Boolean) ?? [],
      hidden: p.get('hidden') === '1',
      reveal: p.get('show')?.split(',').filter(Boolean) ?? [],
      drafts: p.get('drafts') === 'all' ? 'all' : p.get('drafts') === 'mine' ? 'mine' : null,
   };
}

function buildHash(s: HashState): string {
   const p = new URLSearchParams();
   if (s.lens !== 'review') p.set('lens', s.lens);
   if (s.person) p.set('person', s.person);
   if (s.team) p.set('team', s.team);
   if (s.q) p.set('q', s.q);
   if (s.repos.length) p.set('repos', s.repos.join(','));
   if (s.authors.length) p.set('authors', s.authors.join(','));
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
function Banner({ tone, children }: { tone: 'bad' | 'warn' | 'brand'; children: ReactNode }) {
   const inner: Record<typeof tone, string> = {
      bad: 'border-bad bg-surface text-bad',
      warn: 'border-warn bg-surface',
      brand: 'notice-inner border-brand bg-brand-50 text-brand-700',
   };
   return (
      <div className="mx-auto mt-3 max-w-[1240px] px-5 text-[13px]">
         <div
            className={`flex items-center gap-2 rounded-lg border px-3 py-[7px] ${inner[tone]}`}
            role={tone === 'brand' ? undefined : 'alert'}
         >
            {children}
         </div>
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
   useNotifications(pulls, me);
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
   }, [lens, person, team, query, scope, showAll, reveal, draftsMode, settings.draftsMode]);
   useEffect(() => {
      const onHash = () => {
         const h = readHash();
         setLens(h.lens);
         setPerson(h.person);
         setTeam(h.team);
         setQuery(h.q);
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

   const scoped = useMemo(() => {
      let out = pulls;
      if (legacy) out = applyLegacyFilters(out, legacy, me);
      // Muted (user) and org-hidden repos, muted people, and cryo PRs stay off
      // the board unless a session act reveals them: an explicit reveal, a
      // scope, or a repo:/author: query term. Session-explicit beats the
      // durable mute. Never hide your own pulls or bots — bots have their own
      // fold, and a person can't mute themselves off their own board.
      if (!showAll)
         out = out.filter(p => {
            const hiddenRepo =
               repoHidden(p.data.repo, hiddenRepos, settings.repoPrefs) &&
               !revealedRepo(p.data.repo);
            const hiddenPerson =
               p.data.user.login !== me &&
               !isBot(p) &&
               personHidden(p.data.user.login, settings.mutedPeople) &&
               !revealedAuthor(p.data.user.login);
            const cryoHidden = p.cryo && !settings.showCryo && !reveal.includes(CRYO_KEY);
            // a snoozed pull stays off the board until tomorrow or its next
            // change; the master reveal shows it like every other hidden group
            return !hiddenRepo && !hiddenPerson && !cryoHidden && !isSnoozed(p.data, snoozed);
         });
      if (scope.repos.length) out = out.filter(p => scope.repos.includes(p.data.repo));
      // bots bypass the people filter on purpose: dependency bumps need review
      // no matter whose work you follow (they land in the bots fold, not lanes)
      if (scope.authors.length)
         out = out.filter(p => isBot(p) || scope.authors.includes(p.data.user.login));
      // drafts: 'mine' hides other people's drafts, your own always show.
      // The legacy path owns its own draft rule, so don't double-apply.
      if (!legacy && draftsMode === 'mine')
         out = out.filter(p => !p.data.draft || p.data.user.login === me);
      if (query) out = out.filter(p => matchesQuery(p, query, me));
      return out;
   }, [
      pulls,
      scope,
      query,
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
   ]);

   // memoized so the arrays keep their identity across unrelated re-renders
   // (each keystroke, settings toggle, and heartbeat re-runs App)
   const humans = useMemo(() => scoped.filter(p => !isBot(p)), [scoped, isBot]);
   const bots = useMemo(() => scoped.filter(isBot), [scoped, isBot]);
   // "did my PR merge over the weekend" is the cheapest answer the board can
   // give — a slim banner, since the open-PR changes live in the lane
   const mergedCount = closed.filter(p => (epoch(p.closed_at ?? '') || 0) > lastSeen).length;
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

   const cryoCount = pulls.filter(p => p.cryo).length;
   // counts every open pull a snooze currently hides, for the Settings surface
   const snoozedCount = pulls.filter(p => isSnoozed(p.data, snoozed)).length;

   const isScoped = scope.repos.length || scope.authors.length || query;

   const onPerson = useCallback((login: string) => {
      setPerson(login);
      setTeam(null);
      setLens('people');
   }, []);
   // a row's weight chip sets the query to that token; clicking the same
   // chip again (query already exactly that token) clears it instead of
   // re-applying it, so the chip doubles as its own toggle
   const onQueryToken = useCallback((token: string) => {
      setQuery(prev => (prev === token ? '' : token));
   }, []);
   // stable identity so memo(Row) can skip untouched rows on socket bursts
   const rowOpts: RowOptions = useMemo(
      () => ({
         me,
         lastSeen,
         acked,
         onPerson,
         onQueryToken,
         ageWarnDays: settings.ageWarnDays,
         ageRotDays: settings.ageRotDays,
         compact: settings.density === 'compact',
         laneCap: settings.laneCap,
      }),
      [
         me,
         lastSeen,
         acked,
         onPerson,
         onQueryToken,
         settings.ageWarnDays,
         settings.ageRotDays,
         settings.density,
         settings.laneCap,
      ]
   );

   const mineCount = humans.filter(p => p.data.user.login === me).length;
   const tab = (id: Lens, label: string, count?: number) => (
      <button
         type="button"
         aria-current={lens === id ? 'page' : undefined}
         onClick={() => setLens(id)}
         className={`pressable rounded-lg border-0 px-3 py-2 text-sm font-medium ${
            lens === id ? 'bg-secondary text-ink' : 'bg-transparent text-ink-2 hover:text-brand'
         }`}
      >
         {label}
         {count != null && count > 0 && (
            <span className="ml-1.5 text-xs text-ink-3 tabular-nums">{count}</span>
         )}
      </button>
   );

   return (
      <>
         <header ref={headerRef} className="sticky top-0 z-10 border-b border-line bg-surface">
            <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-3.5 gap-y-1 px-5 py-2.5">
               {/* the page's one h1 — heading navigation needs a root, and
                   every lane h2 needs a parent level */}
               <h1 className="m-0 text-base font-semibold tracking-tight">
                  pull<em className="text-brand not-italic">dasher</em>
               </h1>
               <span
                  role="status"
                  className={`h-[7px] w-[7px] rounded-full ${
                     connection === 'connected'
                        ? 'conn-live bg-ok'
                        : connection === 'connecting'
                          ? 'bg-warn'
                          : 'bg-bad'
                  }`}
                  title={connection}
               >
                  <span className="sr-only">live updates {connection}</span>
               </span>
               {refreshProgress && (
                  // no spinner, no color — the changing number is the motion,
                  // same wording Settings' Data group shows for the same state
                  <span className="text-xs text-ink-3 tabular-nums">
                     {refreshProgress.done === refreshProgress.total
                        ? `refreshed ${refreshProgress.total}`
                        : `refreshing ${refreshProgress.done} of ${refreshProgress.total}`}
                  </span>
               )}
               <span className="text-xs text-ink-3 tabular-nums">
                  <b className="text-ink">
                     {isScoped ? `${scoped.length} of ${pulls.length}` : pulls.length}
                  </b>{' '}
                  open
               </span>
               <span className="flex-1" />
               <a
                  href="/"
                  className="text-xs text-ink-3 transition-colors duration-150 ease-out hover:text-brand motion-reduce:transition-none"
                  title="the classic board"
               >
                  v1 board
               </a>
               <Legend />
               <Settings
                  repos={repoCounts}
                  orgHidden={hiddenRepos}
                  snoozedCount={snoozedCount}
                  extraBots={extraBots}
               />
            </div>
            <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-2 px-5 pb-2.5">
               <nav className="mr-1 flex gap-1">
                  {tab('review', 'Review')}
                  {tab('mine', 'My work', mineCount)}
                  {tab('team', 'Team')}
                  {tab('people', 'People')}
                  {tab('classic', 'Classic')}
                  {tab('stats', 'Stats')}
               </nav>
               <RepoFilter
                  repos={repoCounts}
                  orgHidden={hiddenRepos}
                  reveal={reveal}
                  toggleReveal={toggleReveal}
                  showAll={showAll}
                  setShowAll={setShowAll}
                  cryoCount={cryoCount}
                  draftsMode={draftsMode}
                  setDraftsMode={setDraftsMode}
                  scope={scope}
                  setScope={setScope}
               />
               <PeopleFilter
                  pulls={pulls}
                  teams={allTeams}
                  scope={scope}
                  setScope={setScope}
               />
               <FilterChips
                  reveal={reveal}
                  toggleReveal={toggleReveal}
                  showAll={showAll}
                  setShowAll={setShowAll}
                  draftsMode={draftsMode}
                  setDraftsMode={setDraftsMode}
                  scope={scope}
                  setScope={setScope}
               />
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
                     <span aria-hidden>✕</span>
                  </ToggleChip>
               )}
               <span className="flex-1" />
               {bots.length > 0 && (
                  <span className="text-xs text-ink-3 tabular-nums">
                     {n(bots.length, 'bot PR')}
                  </span>
               )}
               <span className="relative ml-auto inline-flex max-w-full grow items-center sm:grow-0">
                  <svg
                     viewBox="0 0 16 16"
                     aria-hidden
                     className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 fill-ink-3"
                  >
                     <path d="M7 2a5 5 0 1 0 3.02 8.98l2.5 2.5a.75.75 0 1 0 1.06-1.06l-2.5-2.5A5 5 0 0 0 7 2Zm0 1.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" />
                  </svg>
                  <input
                     ref={searchRef}
                     type="search"
                     aria-label="Filter PRs: text, #number, label:x, status:x, older:5, repo:x, author:x, weight:xs, has:action, is:restamp, is:blocked"
                     placeholder="Filter (press /)"
                     title="text, #number, label:x, status:x, older:5, repo:x, author:x, weight:xs, has:action, is:restamp, is:blocked"
                     value={query}
                     onChange={e => setQuery(e.target.value)}
                     className="h-8 w-[210px] max-w-full grow rounded-lg border border-line bg-surface pr-2.5 pl-8 text-[13px] sm:grow-0"
                  />
               </span>
            </div>
         </header>

         {authFailed && (
            <Banner tone="bad">
               <span className="font-semibold">Sign-in failed.</span>
               <span className="text-ink-2">
                  Your session may have expired.{' '}
                  <a href="/v2/" className="font-semibold underline">
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
         {mergedCount > 0 && !query && (
            <Banner tone="brand">
               <span>●</span>
               <span className="tabular-nums">
                  <b className="font-semibold">{mergedCount}</b> merged or closed since your last
                  look
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
            {initialized && lens === 'stats' && (
               <Stats pulls={humans} closed={closed} me={me} onPerson={onPerson} />
            )}
         </main>
      </>
   );
}
