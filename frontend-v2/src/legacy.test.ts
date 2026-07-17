import { describe, expect, it } from 'vitest';
import { readLegacyView } from './legacy';

describe('readLegacyView', () => {
   it('returns null when no v1 params are present', () => {
      expect(readLegacyView('')).toBeNull();
      expect(readLegacyView('?utm_source=slack')).toBeNull();
   });

   it('parses repo and author lists', () => {
      const v = readLegacyView('?repo=ifixit,valkyrie&author=danielbeardsley');
      expect(v?.repos).toEqual(['ifixit', 'valkyrie']);
      expect(v?.authors).toEqual(['danielbeardsley']);
      expect(v?.showAllRepos).toBe(false);
   });

   it('treats SHOWALL as unfiltered but remembers it', () => {
      const v = readLegacyView('?repo=SHOWALL');
      expect(v?.repos).toEqual([]);
      expect(v?.showAllRepos).toBe(true);
   });

   it('applies v1 boolean defaults', () => {
      const v = readLegacyView('?cryo=1');
      expect(v?.cryo).toBe(true);
      expect(v?.externalBlock).toBe(true); // default show
      expect(v?.drafts).toBe(false); // default hide
      expect(v?.personal).toBe(false);
      expect(v?.closed).toBe(false);
   });

   it('reads external_block=0 as hide', () => {
      expect(readLegacyView('?external_block=0')?.externalBlock).toBe(false);
   });

   it('collects collapsed columns from ?cr=0-style flags', () => {
      const v = readLegacyView('?cr=0&qa=0&ready=1');
      expect(v?.collapsed).toEqual(new Set(['cr', 'qa']));
   });
});
