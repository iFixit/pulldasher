import type { PullData } from '../../../shared/types';

/**
 * The dummy board at the size of the real one. `?projects=100` in the URL
 * adds that many projects in flight, each with a few open PRs cloned from the
 * fixture, so the Projects tab can be designed against a hundred rows
 * instead of a dozen. Everything is derived from the index, so a reload
 * looks the same. Lazy: only a board with the parameter loads it.
 */
export function scaleCount(): number {
   // no location under the unit tests, which never scale
   const search = typeof location === 'undefined' ? '' : location.search;
   const n = Number(new URLSearchParams(search).get('projects'));
   return Number.isInteger(n) && n > 0 ? Math.min(n, 300) : 0;
}

const AREAS = [
   'Cart',
   'Checkout',
   'Search',
   'Guide editor',
   'Answers',
   'Wiki',
   'Store',
   'Parts finder',
   'Teardowns',
   'Pro tools',
   'Warehouse',
   'Shipping',
   'Returns',
   'Translations',
   'Accounts',
   'Emails',
   'Media',
   'API',
   'CI',
   'Monitoring',
];
const THINGS = [
   'autosave',
   'redesign',
   'price rules',
   'speedups',
   'cleanup',
   'accessibility pass',
   'mobile layout',
   'filters',
   'tax rules',
   'caching',
   'error handling',
   'onboarding',
   'reports',
   'migration',
   'bulk edit',
   'sync fixes',
   'image pipeline',
   'permissions',
   'ranking',
   'dark mode',
];
/** fixture logins: the first ten are the dummy developer teams, the rest are
 * the extra developers a scaled board adds, then non-developers */
export const SCALE_AUTHORS = [
   'danielbeardsley',
   'jarstelfox',
   'sctice',
   'zdmitchell',
   'mlahargou',
   'ardelato',
   'rjmccluskey',
   'sivadnor',
   'hackalot805',
   'djmetzle',
   'scbarber',
   'ianrohde',
   'BaseInfinity',
   'jyee27',
   'cdcline',
   'evannoronha',
   'andrewjpiro',
   'andyg0808',
   'Michelle5102',
   'addison-grant',
   'ShadyAlzayat',
   'bhuminson',
   'bcooper94',
   'emmalopezcode',
];

/** The developers a scaled board adds to each dummy team. */
export const SCALE_TEAM_ADDS: Record<string, string[]> = {
   Store: ['scbarber', 'ianrohde'],
   FixBot: ['BaseInfinity', 'jyee27', 'cdcline'],
   Community: ['evannoronha', 'andrewjpiro', 'andyg0808'],
};

export interface ScaleProject {
   slug: string;
   name: string;
   lead: string;
   /** days ago its first PR opened */
   startDaysAgo: number;
   prs: number;
   /** whether the dummy roadmap plans it: about one in eight */
   planned: boolean;
}

export function scaleProjects(n: number): ScaleProject[] {
   return Array.from({ length: n }, (_, k) => {
      const name = `${AREAS[k % AREAS.length]} ${
         THINGS[(k * 7 + Math.floor(k / AREAS.length)) % THINGS.length]
      }`;
      const slug = `s${k}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
         .slice(0, 24)
         .replace(/-+$/, '');
      return {
         slug,
         name,
         lead: SCALE_AUTHORS[(k * 5) % SCALE_AUTHORS.length],
         startDaysAgo: 3 + ((k * 37) % 170),
         prs: 1 + (k % 4),
         planned: k % 8 === 0,
      };
   });
}

/** Each scaled project's open PRs, cloned from the fixture's open ones. */
export function scalePulls(template: PullData[], n: number, prefix: string): PullData[] {
   const open = template.filter(p => p.state === 'open' && !p.user.login.includes('['));
   const now = Date.now();
   let number = 80000;
   return scaleProjects(n).flatMap((project, k) =>
      Array.from({ length: project.prs }, (_, j) => {
         const base = open[(k * 3 + j) % open.length];
         const created = new Date(
            now - Math.max(1, project.startDaysAgo - j * 5) * 86400_000
         ).toISOString();
         number += 1;
         return {
            ...base,
            number,
            title: `${project.name}: part ${j + 1}`,
            user: {
               ...base.user,
               login: j === 0 ? project.lead : SCALE_AUTHORS[(k + j * 3) % SCALE_AUTHORS.length],
            },
            created_at: created,
            updated_at: new Date(now - ((k + j) % 9) * 86400_000).toISOString(),
            labels: [
               {
                  title: prefix + project.slug,
                  number,
                  repo: base.repo,
                  user: 'projects-bot[bot]',
                  created_at: created,
               },
            ],
         };
      })
   );
}
