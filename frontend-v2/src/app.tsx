import { useEffect, useMemo, useRef, useState } from 'react';
import { ago, n } from './format';
import { readStorage, writeStorage } from './storage';
import { STATUS_ORDER, type DerivedPull } from './model/status';
import type { Team } from './types';
import { usePulldasher } from './store';
import { loadTeams, useScope } from './prefs';
import { Legend } from './components/Legend';
import { ScopeControl } from './components/Scope';
import { STATUS_LABEL } from './components/bits';
import type { RowOptions } from './components/Row';
import { Review } from './views/Review';
import { MyWork } from './views/MyWork';
import { People } from './views/People';
import { Board } from './views/Board';

type Lens = 'review' | 'mine' | 'people' | 'board';

const THEME_KEY = 'pd2.theme';
const BOT_LOGINS = new Set(['ifixit-systems']);
const isBot = (p: DerivedPull) =>
   p.data.user.login.endsWith('[bot]') || BOT_LOGINS.has(p.data.user.login);

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
   } = usePulldasher();
   const [scope] = useScope();
   const [lens, setLens] = useState<Lens>('review');
   const [person, setPerson] = useState<string | null>(null);
   const [team, setTeam] = useState<string | null>(null);
   const [query, setQuery] = useState('');
   const [onlyChanged, setOnlyChanged] = useState(false);
   const [showHidden, setShowHidden] = useState(false);
   const [teams, setTeams] = useState<Team[]>([]);
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
      void loadTeams().then(setTeams);
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
      // v1 conventions: Cryogenic-Storage pulls and hideByDefault repos stay
      // off the board unless asked for (or the scope names the repo).
      if (!showHidden)
         out = out.filter(
            p => !p.cryo && (!hiddenRepos.has(p.data.repo) || scope.repos.includes(p.data.repo))
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
   }, [pulls, scope, query, showHidden, hiddenRepos]);

   const scoped = useMemo(
      () =>
         onlyChanged
            ? inScope.filter(p => Date.parse(p.data.updated_at) / 1000 > lastSeen)
            : inScope,
      [inScope, onlyChanged, lastSeen]
   );

   const humans = scoped.filter(p => !isBot(p));
   const bots = scoped.filter(isBot);
   const changedCount = inScope.filter(
      p => !isBot(p) && Date.parse(p.data.updated_at) / 1000 > lastSeen
   ).length;
   const hiddenCount = pulls.filter(
      p => p.cryo || (hiddenRepos.has(p.data.repo) && !scope.repos.includes(p.data.repo))
   ).length;

   const statusCounts = new Map<string, number>();
   for (const p of humans) statusCounts.set(p.status, (statusCounts.get(p.status) ?? 0) + 1);
   const isScoped = scope.repos.length || scope.authors.length || query || onlyChanged;

   const rowOpts: RowOptions = {
      me,
      lastSeen,
      onPerson: login => {
         setPerson(login);
         setTeam(null);
         setLens('people');
      },
   };

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
                  {tab('board', 'Board')}
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
               {onlyChanged && (
                  <button
                     type="button"
                     onClick={() => setOnlyChanged(false)}
                     title="showing only PRs changed since your last look. Click to show everything"
                     className="pressable inline-flex h-8 items-center gap-1.5 rounded-lg border border-brand bg-brand-50 px-2.5 text-xs font-medium text-brand-700"
                  >
                     changed only ✕
                  </button>
               )}
               {hiddenCount > 0 && (
                  <button
                     type="button"
                     onClick={() => setShowHidden(v => !v)}
                     className={`pressable inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium ${
                        showHidden
                           ? 'border-brand bg-brand-50 text-brand-700'
                           : 'border-line bg-surface text-ink-3 hover:text-brand'
                     }`}
                     title="Cryogenic-Storage PRs and hide-by-default repos"
                  >
                     ❄ {hiddenCount} hidden
                  </button>
               )}
               <span className="flex-1" />
               <span className="text-xs text-ink-3 tabular-nums">{bots.length} bot PRs</span>
               <Legend />
            </div>
         </header>

         {authFailed && (
            <div className="mx-auto mt-3 max-w-[1240px] px-5 text-[13px]">
               <div
                  className="flex items-center gap-2 rounded-lg border border-bad bg-surface px-3 py-[7px] text-bad"
                  role="alert"
               >
                  <span className="font-semibold">Sign-in failed.</span>
                  <span className="text-ink-2">
                     Your session may have expired.{' '}
                     <a href="/v2/" className="font-semibold underline">
                        Reload to sign in again
                     </a>
                     .
                  </span>
               </div>
            </div>
         )}
         {initialized && (connection === 'disconnected' || connection === 'error') && (
            <div className="mx-auto mt-3 max-w-[1240px] px-5 text-[13px]">
               <div
                  className="flex items-center gap-2 rounded-lg border border-warn bg-surface px-3 py-[7px]"
                  role="alert"
               >
                  <span className="font-semibold text-warn">Live updates lost.</span>
                  <span className="text-ink-2">
                     Showing data as of {lastPayloadAt ? `${ago(lastPayloadAt)} ago` : 'page load'},
                     retrying in the background.
                  </span>
               </div>
            </div>
         )}
         {changedCount > 0 && !query && (
            <div className="mx-auto mt-3 max-w-[1240px] px-5 text-[13px]">
               <div className="notice-inner flex items-center gap-2 rounded-lg border border-brand bg-brand-50 px-3 py-[7px] text-brand-700">
                  <span>●</span>
                  <span className="tabular-nums">
                     <b className="font-semibold">{n(changedCount, 'PR')}</b> changed since your
                     last look
                  </span>
                  <button
                     type="button"
                     onClick={() => setOnlyChanged(v => !v)}
                     className="border-0 bg-transparent p-0 text-[13px] font-semibold underline"
                  >
                     {onlyChanged ? 'show everything' : 'show only changes'}
                  </button>
               </div>
            </div>
         )}

         <main key={lens} className="mx-auto mt-4 max-w-[1240px] px-5 pb-16">
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
            {initialized && lens === 'board' && <Board pulls={humans} bots={bots} opts={rowOpts} />}
         </main>
      </>
   );
}
