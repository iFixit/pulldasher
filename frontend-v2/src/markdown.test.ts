// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown — the description preview is safe and GitHub-flavored', () => {
   it('renders basic markdown', () => {
      const html = renderMarkdown('**bold** and _em_');
      expect(html).toContain('<strong>bold</strong>');
      expect(html).toContain('<em>em</em>');
   });

   it('strips script and inline handlers (author input never runs)', () => {
      const html = renderMarkdown('hi <script>alert(1)</script> <img src=x onerror=alert(1)>');
      expect(html).not.toContain('script');
      expect(html).not.toContain('onerror');
   });

   it('drops the HTML comments PR templates leave behind', () => {
      expect(renderMarkdown('<!-- fill this in -->\nreal text')).not.toContain('fill this in');
   });

   it('opens every link in a new tab', () => {
      const html = renderMarkdown('[a link](https://example.com)');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
   });

   it('keeps task-list checkboxes but inert', () => {
      const html = renderMarkdown('- [x] done\n- [ ] todo');
      expect(html).toContain('type="checkbox"');
      expect(html).toContain('disabled');
   });

   it('treats single newlines as breaks, the way GitHub renders PR bodies', () => {
      expect(renderMarkdown('line one\nline two')).toContain('<br>');
   });
});
