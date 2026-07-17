import type { DerivedPull } from './model/status';
import { shortRepo } from './format';

/**
 * v1 saved its settings in the query string, and years of bookmarks encode
 * them: ?repo=…&author=…&cryo=1&personal=1&closed=1 plus per-column collapse
 * flags. Those URLs must keep working when v2 answers them — a legacy URL
 * opens the Classic lens with the same pulls visible and the same columns
 * collapsed. This module owns that translation; nothing else reads the
 * query string.
 */

export interface LegacyView {
   /** v1 ?cryo=1 — show Cryogenic Storage pulls */
   cryo: boolean;
   /** v1 ?external_block=0 — hide externally-blocked pulls (default shows) */
   externalBlock: boolean;
   /** v1 ?drafts=1 — show other people's drafts (default hides them) */
   drafts: boolean;
   /** v1 ?personal=1 — only pulls you author, stamped, block, or joined */
   personal: boolean;
   /** v1 ?closed=1 — the Recently Closed panel */
   closed: boolean;
   /** v1 ?repo=a,b — short repo names; empty = the default set */
   repos: string[];
   /** v1 ?repo=SHOWALL — every repo including hide-by-default ones */
   showAllRepos: boolean;
   /** v1 ?author=x,y — logins; empty = everyone */
   authors: string[];
   /** v1 ?ci=0&cr=0… — collapsed column ids */
   collapsed: Set<string>;
}

const BOOL_KEYS = ['cryo', 'external_block', 'drafts', 'personal', 'closed'];
export const LEGACY_COLUMN_IDS = ['ci', 'dep', 'ready', 'dev', 'cr', 'qa'];
const SHOWALL = 'SHOWALL';

export function readLegacyView(search: string): LegacyView | null {
   const p = new URLSearchParams(search);
   const known = [...BOOL_KEYS, ...LEGACY_COLUMN_IDS, 'repo', 'author'];
   if (!known.some(k => p.has(k))) return null;
   const list = (key: string) =>
      (p.get(key) ?? '')
         .split(',')
         .filter(Boolean)
         .filter(v => v !== SHOWALL);
   return {
      cryo: p.get('cryo') === '1',
      externalBlock: p.get('external_block') !== '0',
      drafts: p.get('drafts') === '1',
      personal: p.get('personal') === '1',
      closed: p.get('closed') === '1',
      repos: (p.get('repo') ?? '').includes(SHOWALL) ? [] : list('repo'),
      showAllRepos: (p.get('repo') ?? '').includes(SHOWALL),
      authors: list('author'),
      collapsed: new Set(LEGACY_COLUMN_IDS.filter(k => p.get(k) === '0')),
   };
}

/** v1 isMineViaAffiliation: author, any stamp or block of mine, or participant. */
function isAffiliated(p: DerivedPull, me: string): boolean {
   const s = p.data.status;
   const mine = (sigs: { data: { user: { login: string } } }[]) =>
      sigs.some(sig => sig.data.user.login === me);
   return (
      p.data.user.login === me ||
      mine(s.allCR) ||
      mine(s.allQA) ||
      mine(s.dev_block) ||
      mine(s.deploy_block) ||
      (p.data.participants ?? []).includes(me)
   );
}

/**
 * The filter pipeline a v1 URL implies, defaults included: v1 hid other
 * people's drafts unless ?drafts=1, so a bookmark without the param expects
 * them gone.
 */
export function applyLegacyFilters(
   pulls: DerivedPull[],
   view: LegacyView,
   me: string
): DerivedPull[] {
   let out = pulls;
   if (!view.drafts) out = out.filter(p => !p.data.draft || p.data.user.login === me);
   if (!view.externalBlock) out = out.filter(p => !p.externalBlock);
   if (view.personal) out = out.filter(p => isAffiliated(p, me));
   if (view.repos.length) out = out.filter(p => view.repos.includes(shortRepo(p.data.repo)));
   if (view.authors.length) out = out.filter(p => view.authors.includes(p.data.user.login));
   return out;
}

/** One-line receipt for the chip so the user sees what the old URL applied. */
export function describeLegacyView(view: LegacyView): string {
   const parts: string[] = [];
   if (view.repos.length) parts.push(`repo ${view.repos.join(', ')}`);
   if (view.showAllRepos) parts.push('all repos');
   if (view.authors.length) parts.push(`author ${view.authors.join(', ')}`);
   if (view.personal) parts.push('personal');
   if (!view.drafts) parts.push('drafts hidden');
   if (!view.externalBlock) parts.push('external hidden');
   if (view.cryo) parts.push('cryo shown');
   if (view.closed) parts.push('recently closed');
   if (view.collapsed.size) parts.push(`${view.collapsed.size} columns collapsed`);
   return parts.join(' · ');
}
