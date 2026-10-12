import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';

describe('Finish line is opt-in', () => {
   it('shows only the header count by default, and closes without a hold', () => {
      expect(DEFAULT_SETTINGS.finishLineMode).toBe('manual');
      expect(DEFAULT_SETTINGS.finishLineHoldToClose).toBe(false);
   });
});
