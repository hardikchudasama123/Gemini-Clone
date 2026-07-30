import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Marked } from 'marked';

const marked = new Marked({
  gfm: true,
  breaks: true,
});

// Syntax-highlight fenced blocks and stash the raw source for the copy button.
marked.use({
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').split(/\s+/)[0].toLowerCase();
      const known = language && hljs.getLanguage(language);

      let body;
      try {
        body = known
          ? hljs.highlight(text, { language, ignoreIllegals: true }).value
          : hljs.highlightAuto(text).value;
      } catch {
        body = escapeHtml(text);
      }

      const label = known ? language : 'code';
      return (
        `<div class="code-block" data-lang="${escapeHtml(label)}">` +
        `<pre><code class="hljs language-${escapeHtml(label)}">${body}</code></pre>` +
        `<textarea class="code-source" aria-hidden="true" tabindex="-1" readonly>${escapeHtml(text)}</textarea>` +
        `</div>`
      );
    },
  },
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Force external links to open safely in a new tab.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function renderMarkdown(text) {
  if (!text) return '';
  const html = marked.parse(text);
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'data-lang', 'aria-hidden', 'tabindex', 'readonly'],
    ADD_TAGS: ['textarea'],
  });
}
