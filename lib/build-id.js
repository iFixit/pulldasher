import { createHash } from 'crypto';
import { readFileSync } from 'fs';

/**
 * Names the frontend build being served: a hash of the built index.html,
 * which references the hashed asset files, so it changes on every deploy.
 * Undefined when there is no build (dev, tests), which turns the client's
 * "Pulldasher was updated" check off.
 */
export function buildIdOf(indexPath) {
   try {
      return createHash('sha1').update(readFileSync(indexPath)).digest('hex').slice(0, 12);
   } catch {
      return undefined;
   }
}

export default buildIdOf(new URL('../frontend-v2/dist/index.html', import.meta.url));
