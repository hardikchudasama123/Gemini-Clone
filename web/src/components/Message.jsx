import { useState } from 'react';

import Markdown from './Markdown.jsx';
import { Icon } from './Icons.jsx';

function domainOf(uri) {
  try {
    return new URL(uri).hostname.replace(/^www\./, '');
  } catch {
    return uri;
  }
}

function Thinking({ text, streaming }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`thinking${open ? ' open' : ''}`}>
      <button type="button" className="thinking-toggle" onClick={() => setOpen((v) => !v)}>
        <Icon.Brain width={16} height={16} />
        <span>{streaming ? 'Thinking…' : 'Thoughts'}</span>
        <Icon.Chevron width={15} height={15} className="thinking-chevron" />
      </button>
      {open && (
        <div className="thinking-body">
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
}

function Sources({ items }) {
  return (
    <div className="sources">
      <h4>
        <Icon.Link width={15} height={15} />
        Sources
      </h4>
      <ul>
        {items.map((source, index) => (
          <li key={`${source.uri}-${index}`}>
            <a href={source.uri} target="_blank" rel="noopener noreferrer">
              <span className="source-index">{index + 1}</span>
              <span className="source-text">
                <strong>{source.title}</strong>
                <small>{source.domain || domainOf(source.uri)}</small>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Freshly streamed images carry base64; reloaded ones carry a signed URL. */
function mediaSrc(item) {
  if (item.data) return `data:${item.mimeType};base64,${item.data}`;
  return item.url || null;
}

function GeneratedImage({ image, index }) {
  const src = mediaSrc(image);

  if (!src) {
    return (
      <div className="generated-image evicted">
        <Icon.Image width={22} height={22} />
        <span>Image is no longer available</span>
      </div>
    );
  }

  const extension = (image.mimeType?.split('/')[1] || 'png').replace('jpeg', 'jpg');

  return (
    <figure className="generated-image">
      <img src={src} alt={`Generated image ${index + 1}`} />
      <a className="image-download" href={src} download={`gemini-image-${index + 1}.${extension}`}>
        <Icon.Download width={16} height={16} />
        <span>Download</span>
      </a>
    </figure>
  );
}

function UserAttachments({ attachments }) {
  return (
    <ul className="user-attachments">
      {attachments.map((attachment, index) => {
        const src = attachment.mimeType?.startsWith('image/') ? mediaSrc(attachment) : null;
        if (src) {
          return (
            <li key={`${attachment.name}-${index}`} className="user-attachment image">
              <img src={src} alt={attachment.name} />
            </li>
          );
        }
        return (
          <li key={`${attachment.name}-${index}`} className="user-attachment">
            <Icon.File width={16} height={16} />
            <span>{attachment.name}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function Message({ message, streaming, onRegenerate, onEdit }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text || '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (message.role === 'user') {
    return (
      <article className="message user">
        <div className="user-bubble">
          {message.attachments?.length > 0 && (
            <UserAttachments attachments={message.attachments} />
          )}
          {message.text && <p className="user-text">{message.text}</p>}
        </div>
        <div className="message-actions user-actions">
          <button type="button" className="icon-btn tiny" onClick={copy} title="Copy">
            {copied ? <Icon.Check width={15} height={15} /> : <Icon.Copy width={15} height={15} />}
          </button>
          <button
            type="button"
            className="icon-btn tiny"
            onClick={() => onEdit(message.id)}
            title="Edit and resend"
          >
            <Icon.Pencil width={15} height={15} />
          </button>
        </div>
      </article>
    );
  }

  const hasBody = Boolean(message.text) || message.images?.length > 0;
  const showTyping = streaming && !hasBody;

  return (
    <article className="message model">
      <div className="avatar" aria-hidden="true">
        <Icon.Sparkle width={18} height={18} />
      </div>

      <div className="model-body">
        {message.thought && <Thinking text={message.thought} streaming={streaming && !hasBody} />}

        {showTyping && (
          <div className="typing" aria-label="Gemini is responding">
            <span />
            <span />
            <span />
          </div>
        )}

        {message.text && <Markdown text={message.text} />}

        {message.images?.length > 0 && (
          <div className="image-grid">
            {message.images.map((image, index) => (
              <GeneratedImage key={index} image={image} index={index} />
            ))}
          </div>
        )}

        {message.error && (
          <p className="error-note">
            <strong>Error:</strong> {message.error}
          </p>
        )}

        {message.sources?.length > 0 && <Sources items={message.sources} />}

        {!streaming && (
          <div className="message-actions">
            <button type="button" className="icon-btn tiny" onClick={copy} title="Copy response">
              {copied ? <Icon.Check width={15} height={15} /> : <Icon.Copy width={15} height={15} />}
            </button>
            <button
              type="button"
              className="icon-btn tiny"
              onClick={() => onRegenerate(message.id)}
              title="Regenerate"
            >
              <Icon.Refresh width={15} height={15} />
            </button>
            {message.usage?.totalTokens > 0 && (
              <span className="usage" title="Token usage">
                {message.usage.totalTokens.toLocaleString()} tokens
                {message.usage.thoughtTokens > 0
                  ? ` · ${message.usage.thoughtTokens.toLocaleString()} thinking`
                  : ''}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
