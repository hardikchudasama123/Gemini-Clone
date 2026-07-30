import { useState } from 'react';

import { Icon } from './Icons.jsx';

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export default function Login({ onSignIn, error }) {
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      await onSignIn();
      // On success the browser redirects to Google, so this stays busy.
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <span className="login-mark" aria-hidden="true">
          <Icon.Sparkle width={34} height={34} />
        </span>

        <h1>
          <span className="login-gradient">Gemini</span>
        </h1>
        <p className="login-sub">Sign in to pick up your conversations on any device.</p>

        <button type="button" className="google-btn" onClick={start} disabled={busy}>
          <GoogleMark />
          <span>{busy ? 'Redirecting to Google…' : 'Continue with Google'}</span>
        </button>

        {error && <p className="login-error">{error}</p>}

        <p className="login-fine">
          Your chats are stored in your own Supabase project and are visible only to you.
        </p>
      </div>
    </div>
  );
}
