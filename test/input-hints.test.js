import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputHints, rememberHints, recalledHints } from '../lib/input-hints.js';

test('names each area once, in a fixed order', () => {
   assert.deepEqual(
      inputHints([
         'package.json',
         'apps/web/package.json',
         '.claude/skills/x/SKILL.md',
         'Migrations/0001.sql',
         '.github/workflows/ci.yml',
      ]),
      ['ci', 'migrations', 'agent-docs', 'dependencies']
   );
});

test('each area matches its paths', () => {
   const cases = {
      ci: ['.circleci/config.yml', 'Jenkinsfile', 'lefthook-local.yml', '.buildkite/p.yml'],
      migrations: ['db/migrations/1.php', 'migrations/schema.sql', 'x/y.sql'],
      alerting: ['ops/alerts/db.yml', 'grafana/dash.json', 'lib/sentry.js', 'Prometheus.yml'],
      'agent-docs': ['AGENTS.md', 'a/b/CLAUDE.md', '.agents/x.md', '.cursor/r', '.codex/c'],
      deploy: [
         'Dockerfile',
         'Dockerfile.dev',
         'docker-compose.yml',
         'deploy/x',
         'Capfile',
         'config/deploy.rb',
         'main.tf',
         'helm/c.yaml',
         'k8s/d.yaml',
      ],
      dependencies: [
         'pnpm-lock.yaml',
         'composer.lock',
         'go.mod',
         'requirements-dev.txt',
         'pyproject.toml',
      ],
   };
   for (const [hint, paths] of Object.entries(cases)) {
      for (const path of paths) assert.deepEqual(inputHints([path]), [hint], path);
   }
});

test('ordinary files get no hint', () => {
   assert.deepEqual(inputHints(['src/app.js', 'README.md', 'docs/package-notes.md']), []);
});

test('remembered hints are recalled only for the same head', () => {
   rememberHints('o/r', 1, 'abc', ['ci']);
   assert.deepEqual(recalledHints('o/r', 1, 'abc'), ['ci']);
   assert.equal(recalledHints('o/r', 1, 'def'), null);
});
