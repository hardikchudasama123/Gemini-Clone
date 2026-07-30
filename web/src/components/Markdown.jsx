import { useEffect, useMemo, useRef } from 'react';

import { renderMarkdown } from '../lib/markdown.js';

/**
 * Renders sanitized Markdown and decorates each code block with a
 * language label and a working copy button.
 */
export default function Markdown({ text }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const containerRef = useRef(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    for (const block of root.querySelectorAll('.code-block:not([data-enhanced])')) {
      block.dataset.enhanced = 'true';

      const header = document.createElement('div');
      header.className = 'code-header';

      const label = document.createElement('span');
      label.className = 'code-lang';
      label.textContent = block.dataset.lang || 'code';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-copy';
      button.textContent = 'Copy';
      button.addEventListener('click', async () => {
        const source = block.querySelector('.code-source')?.value ?? '';
        try {
          await navigator.clipboard.writeText(source);
        } catch {
          // Clipboard API needs a secure context; fall back to a temp selection.
          const helper = document.createElement('textarea');
          helper.value = source;
          helper.style.position = 'fixed';
          helper.style.opacity = '0';
          document.body.appendChild(helper);
          helper.select();
          document.execCommand('copy');
          helper.remove();
        }
        button.textContent = 'Copied';
        window.setTimeout(() => {
          button.textContent = 'Copy';
        }, 1400);
      });

      header.append(label, button);
      block.prepend(header);
    }
  }, [html]);

  return (
    <div
      className="markdown"
      ref={containerRef}
      // Content is sanitized with DOMPurify in renderMarkdown().
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
