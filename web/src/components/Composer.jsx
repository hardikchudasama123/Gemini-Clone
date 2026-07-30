import { useEffect, useRef, useState } from 'react';

import { Icon } from './Icons.jsx';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,application/pdf,text/plain,text/csv,text/markdown,audio/wav,audio/mp3,audio/mpeg,audio/ogg,audio/flac,video/mp4,video/webm,video/quicktime';

function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        data: comma === -1 ? result : result.slice(comma + 1),
      });
    };
    reader.readAsDataURL(file);
  });
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Composer({
  onSend,
  onStop,
  busy,
  seed,
  searchGrounding,
  onToggleSearch,
  supportsSearch,
  supportsAttachments,
  placeholder,
  onNotify,
}) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  // Ignore the seed present at mount; only later bumps should fill the box.
  const seenNonce = useRef(seed?.nonce ?? 0);

  useEffect(() => {
    const nonce = seed?.nonce ?? 0;
    if (nonce === seenNonce.current) return;
    seenNonce.current = nonce;
    setText(seed.text || '');
    const el = textareaRef.current;
    if (el) {
      el.focus();
      window.requestAnimationFrame(() => {
        el.selectionStart = el.value.length;
        el.selectionEnd = el.value.length;
      });
    }
  }, [seed]);

  // Grow with content up to a cap, then scroll internally.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);

  useEffect(() => {
    if (!busy) textareaRef.current?.focus();
  }, [busy]);

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const accepted = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        onNotify?.(`${file.name} is larger than ${humanSize(MAX_FILE_BYTES)} and was skipped.`);
        continue;
      }
      try {
        accepted.push(await fileToAttachment(file));
      } catch (error) {
        onNotify?.(error.message);
      }
    }

    if (accepted.length) {
      setAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...accepted.filter((a) => !seen.has(a.id))];
      });
    }
  };

  const submit = () => {
    if (busy) return;
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;

    onSend({ text: trimmed, attachments });
    setText('');
    setAttachments([]);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onPaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const canSend = Boolean(text.trim() || attachments.length);

  return (
    <div className="composer-wrap">
      <div
        className={`composer${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          if (!supportsAttachments) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!supportsAttachments) return;
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        {attachments.length > 0 && (
          <ul className="attachments">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="attachment">
                {attachment.mimeType.startsWith('image/') ? (
                  <img
                    src={`data:${attachment.mimeType};base64,${attachment.data}`}
                    alt={attachment.name}
                  />
                ) : (
                  <span className="attachment-icon">
                    <Icon.File width={18} height={18} />
                  </span>
                )}
                <span className="attachment-meta">
                  <strong title={attachment.name}>{attachment.name}</strong>
                  <small>{humanSize(attachment.size)}</small>
                </span>
                <button
                  type="button"
                  className="icon-btn tiny"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() =>
                    setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))
                  }
                >
                  <Icon.Close width={14} height={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={textareaRef}
          className="composer-input"
          value={text}
          rows={1}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          aria-label="Message Gemini"
        />

        <div className="composer-tools">
          <div className="composer-left">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => fileRef.current?.click()}
              disabled={!supportsAttachments}
              title={supportsAttachments ? 'Attach files' : 'This model does not accept files'}
              aria-label="Attach files"
            >
              <Icon.Attach width={18} height={18} />
            </button>

            {supportsSearch && (
              <button
                type="button"
                className={`chip${searchGrounding ? ' on' : ''}`}
                onClick={onToggleSearch}
                aria-pressed={searchGrounding}
                title="Ground answers with Google Search"
              >
                <Icon.Search width={15} height={15} />
                <span>Search</span>
              </button>
            )}
          </div>

          {busy ? (
            <button type="button" className="send stop" onClick={onStop} aria-label="Stop generating">
              <Icon.Stop width={18} height={18} />
            </button>
          ) : (
            <button
              type="button"
              className="send"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send message"
            >
              <Icon.Send width={18} height={18} />
            </button>
          )}
        </div>
      </div>

      <p className="disclaimer">Gemini can make mistakes, so double-check it.</p>
    </div>
  );
}
