import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Verifies Supabase access tokens without ever holding a secret.
 *
 * Preferred path is the project's public JWKS endpoint, which works for
 * projects using asymmetric signing keys. Legacy projects still sign with a
 * shared HS256 secret and publish no usable JWKS, so those fall back to asking
 * the Auth API to identify the token.
 */

let jwkSet = null;
let jwksUnavailable = false;

// Short-lived cache so the fallback path does not call Supabase on every
// message. Access tokens are already short-lived, so 60s is plenty.
const USER_CACHE_TTL_MS = 60_000;
const userCache = new Map();

export function supabaseConfig() {
  let url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  return { url, anonKey, configured: Boolean(url && anonKey) };
}

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

function userFromClaims(payload) {
  const meta = payload.user_metadata || {};
  return {
    id: payload.sub,
    email: payload.email || meta.email || null,
    name: meta.full_name || meta.name || null,
    avatar: meta.avatar_url || meta.picture || null,
  };
}

async function verifyViaJwks(token, url) {
  if (!jwkSet) {
    // jose caches and rotates the key set internally.
    jwkSet = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
  }
  const { payload } = await jwtVerify(token, jwkSet, {
    issuer: `${url}/auth/v1`,
  });
  return userFromClaims(payload);
}

async function verifyViaAuthApi(token, url, anonKey) {
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 401 || res.status === 403) {
    throw new AuthError('Your session has expired. Sign in again.');
  }
  if (!res.ok) {
    throw new AuthError('Could not verify your session. Try again.', 503);
  }

  const user = await res.json();
  return {
    id: user.id,
    email: user.email || null,
    name: user.user_metadata?.full_name || user.user_metadata?.name || null,
    avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
  };
}

function cacheGet(token) {
  const hit = userCache.get(token);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    userCache.delete(token);
    return null;
  }
  return hit.user;
}

function cacheSet(token, user) {
  // Bound the map so a stream of rotated tokens cannot grow it without limit.
  if (userCache.size > 500) userCache.clear();
  userCache.set(token, { user, expires: Date.now() + USER_CACHE_TTL_MS });
}

export async function verifyToken(token) {
  const { url, anonKey, configured } = supabaseConfig();
  if (!configured) {
    throw new AuthError('Sign-in is not configured on this server.', 503);
  }
  if (!token) throw new AuthError('Sign in to continue.');

  const cached = cacheGet(token);
  if (cached) return cached;

  let user = null;

  if (!jwksUnavailable) {
    try {
      user = await verifyViaJwks(token, url);
    } catch (error) {
      // A signature/claim failure on a well-formed JWKS means the token is bad.
      // A missing or empty key set means this project signs with HS256.
      const code = error?.code || '';
      const noKeys =
        code === 'ERR_JWKS_NO_MATCHING_KEY' ||
        code === 'ERR_JWKS_INVALID' ||
        code === 'ERR_JOSE_NOT_SUPPORTED' ||
        /jwks|fetch failed|timed out/i.test(error?.message || '');

      if (!noKeys) throw new AuthError('Your session is invalid. Sign in again.');
      jwksUnavailable = true;
    }
  }

  if (!user) user = await verifyViaAuthApi(token, url, anonKey);

  if (!user?.id) throw new AuthError('Your session is invalid. Sign in again.');
  cacheSet(token, user);
  return user;
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

/** Express middleware: attaches `req.user` or responds 401/503. */
export async function requireUser(req, res, next) {
  try {
    req.user = await verifyToken(bearerToken(req));
    return next();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    return res.status(status).json({ message: error.message || 'Sign in to continue.' });
  }
}
