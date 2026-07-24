/**
 * Resolve `promise` and reply on `res`: the resolved value as JSON on
 * success, or a logged 500 on failure. `label` is used both as the
 * console.error prefix and as the response body's `error` field, so a look
 * at the logs and a look at the response describe the same failure.
 */
export function respondOrError(res, promise, label) {
   return promise
      .then(json => res.json(json))
      .catch(err => {
         console.error(label + ':', err);
         res.status(500).json({ error: label });
      });
}
