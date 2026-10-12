// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, migrateSettings } from './settings';

describe('Finish line is opt-in', () => {
   it('shows only the header count by default, and closes without a hold', () => {
      expect(DEFAULT_SETTINGS.jailMode).toBe('manual');
      expect(DEFAULT_SETTINGS.jailHoldToClose).toBe(false);
   });

   it('moves a saved popup from before to the new default, once', () => {
      const old = { theme: 'dark' as const, jailMode: 'auto' as const };
      const once = migrateSettings(old);
      expect(once).toEqual({ theme: 'dark', jailMode: 'manual', settingsVersion: 1 });
      // turned back on after the move, it stays on
      const chosen = { ...once, jailMode: 'auto' as const };
      expect(migrateSettings(chosen)).toBe(chosen);
   });

   it('keeps Off, and carries over the day-old on/off switch', () => {
      expect(migrateSettings({ jailMode: 'off' }).jailMode).toBe('off');
      expect(migrateSettings({ jailOn: false, jailMode: 'auto' })).toEqual({
         jailMode: 'off',
         settingsVersion: 1,
      });
      expect(migrateSettings({ jailOn: true, jailMode: 'auto' })).toEqual({
         jailMode: 'manual',
         settingsVersion: 1,
      });
   });
});

describe('the saved blob on load', () => {
   afterEach(() => {
      localStorage.clear();
      vi.resetModules();
   });

   it('is migrated before the store reads it', async () => {
      localStorage.setItem('pd2.settings', JSON.stringify({ jailMode: 'auto', theme: 'dark' }));
      vi.resetModules();
      const { getSettings } = await import('./settings');
      expect(getSettings().jailMode).toBe('manual');
      expect(getSettings().theme).toBe('dark');
      expect(JSON.parse(localStorage.getItem('pd2.settings') ?? '{}')).toMatchObject({
         jailMode: 'manual',
         settingsVersion: 1,
      });
   });
});
