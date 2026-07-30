import { useEffect, useRef, useState } from 'react';

import { Icon } from './Icons.jsx';
import { groupChatsByDate } from '../lib/store.js';

function ChatRow({ chat, active, onSelect, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.title);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const title = draft.trim();
    if (title && title !== chat.title) onRename(chat.id, title);
    else setDraft(chat.title);
    setEditing(false);
  };

  if (editing) {
    return (
      <li className="chat-row editing">
        <input
          ref={inputRef}
          className="chat-rename"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(chat.title);
              setEditing(false);
            }
          }}
        />
      </li>
    );
  }

  return (
    <li className={`chat-row${active ? ' active' : ''}`}>
      <button type="button" className="chat-open" onClick={() => onSelect(chat.id)}>
        <span className="chat-title">{chat.title}</span>
      </button>
      <span className="chat-actions">
        <button
          type="button"
          className="icon-btn tiny"
          title="Rename"
          aria-label={`Rename ${chat.title}`}
          onClick={() => {
            setDraft(chat.title);
            setEditing(true);
          }}
        >
          <Icon.Pencil width={15} height={15} />
        </button>
        <button
          type="button"
          className="icon-btn tiny danger"
          title="Delete"
          aria-label={`Delete ${chat.title}`}
          onClick={() => onDelete(chat.id)}
        >
          <Icon.Trash width={15} height={15} />
        </button>
      </span>
    </li>
  );
}

export default function Sidebar({
  open,
  chats,
  activeId,
  theme,
  onClose,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
  onToggleTheme,
}) {
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? chats.filter(
        (chat) =>
          chat.title.toLowerCase().includes(needle) ||
          chat.messages.some((m) => (m.text || '').toLowerCase().includes(needle)),
      )
    : chats;

  return (
    <>
      <div
        className={`scrim${open ? ' show' : ''}`}
        onClick={onClose}
        role="presentation"
        aria-hidden="true"
      />
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Chat history">
        <div className="sidebar-top">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu">
            <Icon.Menu />
          </button>
        </div>

        <button type="button" className="new-chat" onClick={onNewChat}>
          <Icon.Plus width={18} height={18} />
          <span>New chat</span>
        </button>

        <div className="sidebar-search">
          <Icon.Search width={16} height={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
          />
          {query && (
            <button
              type="button"
              className="icon-btn tiny"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <Icon.Close width={14} height={14} />
            </button>
          )}
        </div>

        <nav className="chat-list">
          {visible.length === 0 && (
            <p className="sidebar-empty">{needle ? 'No matching chats' : 'No chats yet'}</p>
          )}
          {groupChatsByDate(visible).map(([label, group]) => (
            <section key={label} className="chat-group">
              <h3>{label}</h3>
              <ul>
                {group.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    active={chat.id === activeId}
                    onSelect={onSelect}
                    onRename={onRename}
                    onDelete={onDelete}
                  />
                ))}
              </ul>
            </section>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button type="button" className="sidebar-link" onClick={onToggleTheme}>
            {theme === 'dark' ? <Icon.Sun width={18} height={18} /> : <Icon.Moon width={18} height={18} />}
            <span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
