const HINTS = [
   [
      'ci',
      /(^|\/)(\.github|\.circleci|\.buildkite)\/|(^|\/)Jenkinsfile[^/]*$|(^|\/)lefthook[^/]*\.ya?ml$/,
   ],
   ['migrations', /(^|\/)migrations\/|(^|\/)schema\.sql$|\.sql$/i],
   [
      'alerting',
      // a whole path segment or file stem, so components/AlertBanner.tsx doesn't count
      /(^|\/)(alerts?|alerting|alertmanager|prometheus|grafana|datadog|pagerduty)(\.[^/]*)?(\/|$)|(^|\/)(sentry\.[^/]*\.config\.[^/]*|\.sentryclirc|sentry\.properties)$/i,
   ],
   ['agent-docs', /(^|\/)(AGENTS|CLAUDE)\.md$|(^|\/)\.(agents|claude|cursor|codex)\//],
   [
      'deploy',
      /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*|Capfile)$|(^|\/)(deploy|terraform|helm|k8s)\/|(^|\/)config\/deploy|\.tf$/,
   ],
   [
      'dependencies',
      /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|composer\.(json|lock)|Gemfile(\.lock)?|go\.(mod|sum)|requirements[^/]*\.txt|pyproject\.toml)$/,
   ],
];

/** Areas a diff touches that usually deserve team input, from its changed
 * paths, in a fixed order and each once. */
export function inputHints(paths) {
   return HINTS.filter(([, re]) => paths.some(p => re.test(p))).map(([key]) => key);
}

// repo#number -> { sha, hints }: what the stored hints were computed for, so
// a restart (Pull.fromDB seeds it) or a repeat refresh doesn't refetch the files
const memo = new Map();
const key = (repo, number) => `${repo}#${number}`;
export const rememberHints = (repo, number, sha, hints) =>
   memo.set(key(repo, number), { sha, hints });
export const recalledHints = (repo, number, sha) => {
   const m = memo.get(key(repo, number));
   return m && m.sha === sha ? m.hints : null;
};
