import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ago, n, shortRepo } from './format';
import { readStorage, writeStorage } from './storage';
import { STATUS_ORDER, type DerivedPull } from './model/status';
import type { Team } from './types';
import { isFresh, usePulldasher } from './store';
import { applyLegacyFilters, describeLegacyView, readLegacyView } from './legacy';
import { loadSiteConfig, useScope } from './prefs';
import { Legend } from './components/Legend';
import { ScopeControl } from './components/Scope';
import { STATUS_LABEL } from './components/bits';
import type { RowOptions } from './components/Row';
import { Review } from './views/Review';
import { MyWork } from './views/MyWork';
import { People } from './views/People';
import { Classic } from './views/Classic';

type Lens = 'review' | 'mine' | 'people' | 'classic';

const LENSES: Lens[] = ['review', 'mine', 'people', 'classic'];

/** Lens and drill-down selections live in the hash: shareable, bookmarkable. */
function readHash() {
   const p = new URLSearchParams(location.hash.slice(1));
   let lens = p.get('lens') as Lens | null;
   // the Board lens merged into Classic (same columns, real justification);
   // old #lens=board links keep working
   if ((lens as string) === 'board') lens = 'classic';
   return {
      lens: lens && LENSES.includes(lens) ? lens : ('review' as Lens),
      person: p.get('person'),
      team: p.get('team'),
   };
}

function writeHash(lens: Lens, person: string | null, team: string | null) {
   const p = new URLSearchParams();
   if (lens !== 'review') p.set('lens', lens);
   if (person) p.set('person', person);
   if (team) p.set('team', team);
   const next = p.toString();
   history.replaceState(null, '', next ? `#${next}` : location.pathname + location.search);
}

const THEME_KEY = 'pd2.theme';
// GitHub Apps carry a [bot] suffix; other machine accounts are named in
// config.json's `bots` list.
const isBotLogin = (login: string, extra: ReadonlySet<string>) =>
   login.endsWith('[bot]') || extra.has(login);

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
   } = usePulldasher();
   const [scope] = useScope();
   // a v1 bookmark (?repo=…&author=…&cryo=1…) opens Classic configured the
   // same way; the chip below shows what it applied and dismisses it
   const [legacy, setLegacy] = useState(() => readLegacyView(location.search));
   const [lens, setLens] = useState<Lens>(() => {
      const h = readHash();
      if (legacy && !location.hash.includes('lens=')) return 'classic';
      return h.lens;
   });
   const [person, setPerson] = useState<string | null>(() => readHash().person);
   const [team, setTeam] = useState<string | null>(() => readHash().team);
   const [query, setQuery] = useState('');
   const [onlyChanged, setOnlyChanged] = useState(false);
   const [showHidden, setShowHidden] = useState(
      () => !!legacy && (legacy.cryo || legacy.showAllRepos)
   );
   const [teams, setTeams] = useState<Team[]>([]);
   const [extraBots, setExtraBots] = useState<ReadonlySet<string>>(new Set());
   const isBot = useCallback(
      (p: DerivedPull) => isBotLogin(p.data.user.login, extraBots),
      [extraBots]
   );
   // explicit choice persists; otherwise follow the OS, live
   const [dark, setDarkState] = useState(
      () =>
         readStorage(THEME_KEY) ??
         (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
   );
   const setDark = (next: string) => {
      setDarkState(next);
      writeStorage(THEME_KEY, next);
   };
   const searchRef = useRef<HTMLInputElement>(null);

   useEffect(() => {
      void loadSiteConfig().then(c => {
         setExtraBots(new Set(c.bots));
         setTeams(c.teams);
      });
   }, []);
   useEffect(() => {
      writeHash(lens, person, team);
   }, [lens, person, team]);
   useEffect(() => {
      const onHash = () => {
         const h = readHash();
         setLens(h.lens);
         setPerson(h.person);
         setTeam(h.team);
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
   useEffect(() => {
      document.documentElement.classList.toggle('dark', dark === 'dark');
   }, [dark]);
   useEffect(() => {
      if (readStorage(THEME_KEY)) return;
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const follow = () => setDarkState(mq.matches ? 'dark' : 'light');
      mq.addEventListener('change', follow);
      return () => mq.removeEventListener('change', follow);
   }, []);
   // v1's `/` hotkey: jump to the filter box from anywhere
   useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
         if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
         const t = e.target as HTMLElement;
         if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable) return;
         e.preventDefault();
         searchRef.current?.focus();
         searchRef.current?.select();
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
   const inScope = useMemo(() => {
      let out = pulls;
      if (legacy) out = applyLegacyFilters(out, legacy, me);
      // v1 conventions: Cryogenic-Storage pulls and hideByDefault repos stay
      // off the board unless asked for (or the scope names the repo).
      if (!showHidden)
         out = out.filter(
            p =>
               !p.cryo &&
               (!hiddenRepos.has(p.data.repo) ||
                  scope.repos.includes(p.data.repo) ||
                  // a legacy URL naming the repo means "show it", hidden or not
                  legacy?.repos.includes(shortRepo(p.data.repo)))
         );
      if (scope.repos.length) out = out.filter(p => scope.repos.includes(p.data.repo));
      // bots bypass the people filter on purpose: dependency bumps need review
      // no matter whose work you follow (they land in the bots fold, not lanes)
      if (scope.authors.length)
         out = out.filter(p => isBot(p) || scope.authors.includes(p.data.user.login));
      if (query) {
         const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
         out = out.filter(p =>
            terms.every(
               t =>
                  p.data.title.toLowerCase().includes(t) ||
                  p.data.repo.toLowerCase().includes(t) ||
                  p.data.user.login.toLowerCase().includes(t)
            )
         );
      }
      return out;
   }, [pulls, scope, query, showHidden, hiddenRepos, legacy, me, isBot]);

   // changed-only and the banner count share one predicate (bots excluded,
   // acked rows drop out) so the toggle always shows exactly what the banner
   // promised
   const scoped = useMemo(
      () =>
         onlyChanged ? inScope.filter(p => !isBot(p) && isFresh(p.data, lastSeen, acked)) : inScope,
      [inScope, onlyChanged, lastSeen, acked, isBot]
   );

   const humans = scoped.filter(p => !isBot(p));
   const bots = scoped.filter(isBot);
   const changedCount = inScope.filter(p => !isBot(p) && isFresh(p.data, lastSeen, acked)).length;
   // "did my PR merge over the weekend" is the cheapest answer the board can
   // give — it belongs in the banner, not buried in a fold
   const mergedCount = closed.filter(
      p => (Date.parse(p.closed_at ?? '') / 1000 || 0) > lastSeen
   ).length;
   const hiddenCount = pulls.filter(
      p => p.cryo || (hiddenRepos.has(p.data.repo) && !scope.repos.includes(p.data.repo))
   ).length;

   const statusCounts = new Map<string, number>();
   for (const p of humans) statusCounts.set(p.status, (statusCounts.get(p.status) ?? 0) + 1);
   const isScoped = scope.repos.length || scope.authors.length || query || onlyChanged;

   const onPerson = useCallback((login: string) => {
      setPerson(login);
      setTeam(null);
      setLens('people');
   }, []);
   // stable identity so memo(Row) can skip untouched rows on socket bursts
   const rowOpts: RowOptions = useMemo(
      () => ({ me, lastSeen, acked, onPerson }),
      [me, lastSeen, acked, onPerson]
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
         <header className="sticky top-0 z-10 border-b border-line bg-surface">
            <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-3.5 gap-y-1 px-5 py-2.5">
               <span className="text-base font-semibold tracking-tight">
                  pull<em className="text-brand not-italic">dasher</em>
               </span>
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
               <span className="min-w-0 truncate text-xs text-ink-3 tabular-nums">
                  <b className="text-ink">
                     {isScoped ? `${scoped.length} of ${pulls.length}` : pulls.length}
                  </b>{' '}
                  open
                  {STATUS_ORDER.filter(s => statusCounts.get(s)).map(s => (
                     <span key={s}>
                        {' · '}
                        {statusCounts.get(s)} {STATUS_LABEL[s].toLowerCase()}
                     </span>
                  ))}
               </span>
               <span className="flex-1" />
               <span className="text-xs text-ink-3">{me ? `signed in as ${me}` : '…'}</span>
               <a
                  href="/"
                  className="text-xs text-ink-3 hover:text-brand"
                  title="the classic board"
               >
                  v1 board
               </a>
               <button
                  type="button"
                  onClick={() => setDark(dark === 'dark' ? 'light' : 'dark')}
                  className="pressable h-8 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium whitespace-nowrap hover:bg-muted"
               >
                  {dark === 'dark' ? 'light mode' : 'dark mode'}
               </button>
            </div>
            <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-2 px-5 pb-2.5">
               <nav className="mr-1 flex gap-1">
                  {tab('review', 'Review')}
                  {tab('mine', 'My work', mineCount)}
                  {tab('people', 'People')}
                  {tab('classic', 'Classic')}
               </nav>
               <ScopeControl pulls={pulls} teams={teams} />
               <input
                  ref={searchRef}
                  type="search"
                  aria-label="Filter PRs by title, repo, or author"
                  placeholder="filter (press /)"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="h-8 w-[170px] rounded-lg border border-line bg-surface px-2.5 text-[13px]"
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
               {onlyChanged && (
                  <ToggleChip
                     active
                     onClick={() => setOnlyChanged(false)}
                     title="showing only PRs changed since your last look. Click to show everything"
                  >
                     changed only ✕
                  </ToggleChip>
               )}
               {hiddenCount > 0 && (
                  <ToggleChip
                     active={showHidden}
                     onClick={() => setShowHidden(v => !v)}
                     title="Cryogenic-Storage PRs and hide-by-default repos"
                  >
                     ❄ {hiddenCount} hidden
                  </ToggleChip>
               )}
               <span className="flex-1" />
               {bots.length > 0 && (
                  <span className="text-xs text-ink-3 tabular-nums">
                     {n(bots.length, 'bot PR')}
                  </span>
               )}
               <Legend />
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
         {(changedCount > 0 || mergedCount > 0) && !query && (
            <Banner tone="brand">
               <span>●</span>
               <span className="tabular-nums">
                  {changedCount > 0 && (
                     <>
                        <b className="font-semibold">{n(changedCount, 'PR')}</b> changed
                     </>
                  )}
                  {changedCount > 0 && mergedCount > 0 && ' · '}
                  {mergedCount > 0 && (
                     <>
                        <b className="font-semibold">{mergedCount}</b> merged or closed
                     </>
                  )}{' '}
                  since your last look
               </span>
               {changedCount > 0 && (
                  <button
                     type="button"
                     onClick={() => setOnlyChanged(v => !v)}
                     className="border-0 bg-transparent p-0 text-[13px] font-semibold underline"
                  >
                     {onlyChanged ? 'show everything' : 'show only changes'}
                  </button>
               )}
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
               <Review pulls={humans} bots={bots} closed={closed} opts={rowOpts} />
            )}
            {initialized && lens === 'mine' && (
               <MyWork pulls={humans} closed={closed} opts={rowOpts} />
            )}
            {initialized && lens === 'people' && (
               <People
                  pulls={humans}
                  allPulls={pulls.filter(p => !isBot(p))}
                  teams={teams}
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
         </main>
      </>
   );
}
