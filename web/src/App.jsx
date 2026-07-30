import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Chat from './Chat.jsx';
import Login from './components/Login.jsx';
import Setup from './components/Setup.jsx';
import { Icon } from './components/Icons.jsx';
import {
  cleanAuthParamsFromUrl,
  createSupabase,
  loadRuntimeConfig,
  signInWithGoogle,
  signOut,
} from './lib/supabase.js';

/** Surfaced when Google hands back an error instead of a session. */
function oauthErrorFromUrl() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const description = hash.get('error_description') || query.get('error_description');
  const code = hash.get('error') || query.get('error');
  if (!code && !description) return null;
  return description ? description.replace(/\+/g, ' ') : `Sign-in failed (${code}).`;
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState(() => oauthErrorFromUrl());

  const theme = useRef(null);

  // Apply the saved theme before anything renders, so the login screen matches.
  if (theme.current === null) {
    try {
      const prefs = JSON.parse(localStorage.getItem('gemini-clone.prefs.v1')) || {};
      theme.current = prefs.theme || 'dark';
    } catch {
      theme.current = 'dark';
    }
    document.documentElement.dataset.theme = theme.current;
  }

  useEffect(() => {
    let cancelled = false;
    loadRuntimeConfig()
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch((error) => {
        if (!cancelled) setConfigError(error.message || 'Could not reach the server.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const supabase = useMemo(() => {
    if (!config?.authConfigured) return null;
    try {
      return createSupabase(config);
    } catch (error) {
      setConfigError(error?.message || 'Invalid Supabase URL configuration.');
      return null;
    }
  }, [config]);

  useEffect(() => {
    if (!supabase) {
      if (config && !config.authConfigured) setReady(true);
      return undefined;
    }

    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data?.session ?? null);
      setReady(true);
      cleanAuthParamsFromUrl();
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) setAuthError(null);
      cleanAuthParamsFromUrl();
    });

    return () => {
      cancelled = true;
      subscription?.subscription?.unsubscribe();
    };
  }, [supabase, config]);

  const handleSignIn = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithGoogle(supabase, config);
    } catch (error) {
      setAuthError(error?.message || 'Could not start Google sign-in.');
      throw error;
    }
  }, [supabase, config]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut(supabase);
    } finally {
      setSession(null);
    }
  }, [supabase]);

  const user = useMemo(() => {
    const raw = session?.user;
    if (!raw) return null;
    const meta = raw.user_metadata || {};
    return {
      id: raw.id,
      email: raw.email || null,
      name: meta.full_name || meta.name || null,
      avatar: meta.avatar_url || meta.picture || null,
    };
  }, [session]);

  if (configError) {
    return (
      <div className="boot">
        <span className="boot-mark">
          <Icon.Sparkle width={30} height={30} />
        </span>
        <p>{configError}</p>
      </div>
    );
  }

  if (!config || !ready) {
    return (
      <div className="boot">
        <span className="boot-mark">
          <Icon.Sparkle width={30} height={30} />
        </span>
        <p>Starting…</p>
      </div>
    );
  }

  if (!config.authConfigured) return <Setup />;
  if (!session || !user) return <Login onSignIn={handleSignIn} error={authError} />;

  return (
    <Chat
      key={user.id}
      supabase={supabase}
      session={session}
      user={user}
      onSignOut={handleSignOut}
    />
  );
}
