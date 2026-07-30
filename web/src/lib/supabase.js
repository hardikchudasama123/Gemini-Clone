import { createClient } from '@supabase/supabase-js';

/**
 * Config is fetched from our own server rather than baked in at build time, so
 * the same bundle works against any project and Docker can inject env at run.
 */
export async function loadRuntimeConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('Could not reach the server.');
  return res.json();
}

export function createSupabase({ supabaseUrl, supabaseAnonKey }) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Needed to pick the session up out of the OAuth redirect URL.
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
}

/**
 * Supabase answers a request for a disabled provider with a bare 400 JSON
 * page on its own domain, stranding the user with no way back. Checking first
 * keeps the failure inside the app, where it can say what to fix.
 */
async function assertGoogleEnabled({ supabaseUrl, supabaseAnonKey }) {
  let settings = null;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabaseAnonKey },
    });
    if (res.ok) settings = await res.json();
  } catch {
    // Cannot reach the settings endpoint — let the redirect attempt proceed
    // rather than blocking sign-in on a check that is only advisory.
    return;
  }

  if (settings?.external && settings.external.google === false) {
    throw new Error(
      'Google sign-in is not enabled on this Supabase project yet. ' +
        'Enable it under Authentication → Providers → Google, then try again.',
    );
  }
}

export async function signInWithGoogle(supabase, config) {
  await assertGoogleEnabled(config);

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: { access_type: 'offline', prompt: 'select_account' },
    },
  });
  if (error) throw error;
}

export async function signOut(supabase) {
  await supabase.auth.signOut();
}

/** Strip the OAuth fragment/query so tokens do not linger in the address bar. */
export function cleanAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  const dirty =
    url.hash.includes('access_token') ||
    url.hash.includes('error') ||
    url.searchParams.has('code') ||
    url.searchParams.has('error');

  if (!dirty) return;
  url.hash = '';
  url.searchParams.delete('code');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  url.searchParams.delete('state');
  window.history.replaceState({}, '', url.pathname + url.search);
}
