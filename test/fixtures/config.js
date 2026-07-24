// Minimal ESM config used only by the test suite (CONFIG_PATH points here).
// Dummy values — nothing here talks to GitHub or MySQL; the tests stub those
// collaborators. It exists to satisfy module-load-time reads across the import
// graph (config-loader repos, git-manager github.token, db.js mysql.*, and the
// regex tables some models compile on import).
const emoji = '(©|®|[ -㌀]|\ud83c[퀀-\udfff]|\ud83d[퀀-\udfff]|\ud83e[퀀-\udfff])';
const signature = '(:[^\n:]+:|' + emoji + ')';

export default {
   title: 'Pulldasher (test)',
   port: 3000,
   github: {
      clientId: 'test-client-id',
      secret: 'test-secret',
      callbackURL: 'http://localhost:3000/auth/github/callback',
      token: 'test-token',
      hook_secret: 'test-hook-secret',
   },
   session: { secret: 'test-session-secret' },

   repos: ['test/repo-a', 'test/repo-b', 'test/repo-c'],

   bots: ['fixture-bot'],
   weightLabels: { 'weight: XL': 'XL' },

   mysql: {
      host: 'localhost',
      db: 'pulldasher_test',
      user: 'test',
      pass: 'test',
   },

   body_tags: [
      { name: 'cr_req', regex: /\bcr_req ([0-9]+)\b/i, default: 1 },
      { name: 'qa_req', regex: /\bqa_req ([0-9]+)\b/i, default: 1 },
      {
         name: 'closes',
         regex: /\b(?:close(?:s|d)?|fix(?:es|ed)?|resolve(?:s|d)?) #([0-9]+)\b/i,
         default: null,
      },
      {
         name: 'connects',
         regex: /\b(?:connect(?:s|ed)? to|connects) #([0-9]+)\b/i,
         default: null,
      },
   ],
   tags: [
      { name: 'dev_block', regex: new RegExp('\\bdev_block ' + signature, 'i') },
      { name: 'un_dev_block', regex: new RegExp('\\bun_dev_block ' + signature, 'i') },
      { name: 'deploy_block', regex: new RegExp('\\bdeploy_block ' + signature, 'i') },
      { name: 'un_deploy_block', regex: new RegExp('\\bun_deploy_block ' + signature, 'i') },
      { name: 'QA', regex: new RegExp('\\bQA ' + signature, 'i') },
      { name: 'CR', regex: new RegExp('\\bCR ' + signature, 'i') },
   ],
   labels: [
      {
         name: 'difficulty',
         regex: /^size: [0-9]+$/,
         process: function (label) {
            const match = label ? label.match(/[0-9]+/) : null;
            return match ? parseInt(match[0], 10) : null;
         },
      },
   ],

   unauthenticated_timeout: 10 * 1000,
   token_timeout: 100 * 1000,
};
