import { useEffect, useRef, useState } from 'react';

import { Icon } from './Icons.jsx';

function initials(user) {
  const source = user.name || user.email || '?';
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export default function UserMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const showImage = user.avatar && !imageFailed;

  return (
    <div className="user-menu" ref={wrapRef}>
      <button
        type="button"
        className="user-avatar"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        title={user.email || user.name || 'Account'}
      >
        {showImage ? (
          <img
            src={user.avatar}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="user-initials">{initials(user)}</span>
        )}
      </button>

      {open && (
        <div className="user-panel" role="menu">
          <div className="user-identity">
            {showImage ? (
              <img src={user.avatar} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="user-initials big">{initials(user)}</span>
            )}
            <span className="user-text">
              {user.name && <strong>{user.name}</strong>}
              {user.email && <small>{user.email}</small>}
            </span>
          </div>

          <button type="button" className="user-action" role="menuitem" onClick={onSignOut}>
            <Icon.Logout width={18} height={18} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
