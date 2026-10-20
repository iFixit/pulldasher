import bodyParser from 'body-parser';

// Everything the board and the API post is small.
const MAX_POST_SIZE = 1024 * 1024;
// GitHub sends webhook payloads up to 25 MB, and a big PR (a long body, many
// labels or a large push) passes 1 MB. Rejected with a 413, that update was
// lost until the hourly reconcile, about a dozen a day on prod.
const MAX_HOOK_SIZE = 25 * 1024 * 1024;

/**
 * Parse request bodies: the webhook route with GitHub's limit, everything
 * else with the small one. The webhook parsers run first; body-parser skips a
 * body that's already parsed, so the global ones leave hook requests alone.
 */
export function useBodyParsers(app) {
   app.use(
      '/hooks',
      bodyParser.urlencoded({ limit: MAX_HOOK_SIZE, extended: false }),
      bodyParser.json({ limit: MAX_HOOK_SIZE })
   );
   app.use(bodyParser.urlencoded({ limit: MAX_POST_SIZE, extended: false }));
   app.use(bodyParser.json({ limit: MAX_POST_SIZE }));
}
