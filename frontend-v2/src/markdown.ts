import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * PR descriptions rendered for the title's hover preview. GitHub flavor:
 * single newlines break (GitHub renders PR bodies that way), gfm tables and
 * strikethrough on. Sanitized because a description is arbitrary author
 * input landing in our DOM — DOMPurify also drops the HTML comments PR
 * templates leave behind. Every link opens in a new tab: the reader is
 * mid-hover on a board they haven't left yet.
 *
 * This module is imported dynamically by the preview panel (first hover),
 * so marked/dompurify stay out of the initial bundle.
 */

DOMPurify.addHook('afterSanitizeAttributes', node => {
   if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
   }
   // task-list checkboxes survive (a QA checklist is exactly the "can I act
   // on this" signal the preview exists for) but stay inert
   if (node.tagName === 'INPUT') node.setAttribute('disabled', '');
});

export function renderMarkdown(md: string): string {
   const raw = marked.parse(md, { async: false, gfm: true, breaks: true });
   return DOMPurify.sanitize(raw, {
      // a description is prose, not an app: no forms, no media players
      FORBID_TAGS: ['style', 'form', 'button', 'iframe', 'video', 'audio'],
   });
}
