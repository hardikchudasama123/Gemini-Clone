/**
 * Setup checker: `npm run check`
 *
 * Reports what is configured and what is still missing, so a half-finished
 * Supabase setup fails here with an explanation rather than at sign-in.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '.env') });

const PASS = '  \x1b[32m✓\x1b[0m';
const FAIL = '  \x1b[31m✗\x1b[0m';
const WARN = '  \x1b[33m!\x1b[0m';

let failures = 0;
const pass = (msg) => console.log(`${PASS} ${msg}`);
const warn = (msg, hint) => console.log(`${WARN} ${msg}${hint ? `\n      → ${hint}` : ''}`);
const fail = (msg, hint) => {
  failures += 1;
  console.log(`${FAIL} ${msg}${hint ? `\n      → ${hint}` : ''}`);
};

const get = async (url, headers) => {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* not json */
    }
    return { status: res.status, ok: res.ok, body };
  } catch (error) {
    return { status: 0, ok: false, error: error.cause?.code || error.message };
  }
};

console.log('\n  Gemini clone — setup check\n');

/* ------------------------------------------------------------------ Groq */

// Groq serves the chat models, Gemini serves images and pdf/audio/video. Either
// key alone is a working app, so a missing one is a warning, not a failure —
// the "no provider at all" case is reported once, after both checks.
console.log('  Groq');
const groqKey = process.env.GROQ_API_KEY;
if (!groqKey) {
  warn(
    'GROQ_API_KEY is not set',
    'Add it to .env — get one at https://console.groq.com/keys. ' +
      'Without it the Groq chat models are hidden from the picker.',
  );
} else {
  const res = await get('https://api.groq.com/openai/v1/models', {
    Authorization: `Bearer ${groqKey}`,
  });
  if (res.ok) {
    // Catch catalogue drift: a model retired upstream would 404 mid-stream.
    const ids = new Set((res.body?.data || []).map((m) => m.id));
    const { MODELS } = await import('./models.js');
    const missing = MODELS.filter((m) => m.provider === 'groq' && !ids.has(m.id)).map((m) => m.id);
    if (missing.length) {
      fail(
        `API key works, but ${missing.length} model id${missing.length === 1 ? '' : 's'} no longer exist upstream`,
        `Update server/models.js: ${missing.join(', ')}`,
      );
    } else {
      pass('API key works, all Groq model ids exist');
    }
  } else if (res.status === 0) {
    fail(`Cannot reach the Groq API (${res.error})`, 'Check network access to api.groq.com.');
  } else {
    fail(`API key rejected (${res.status})`, res.body?.error?.message?.slice(0, 120));
  }
}

/* ---------------------------------------------------------------- Gemini */

console.log('\n  Gemini');
const geminiKey = process.env.GEMINI_API_KEY;
if (!geminiKey) {
  warn(
    'GEMINI_API_KEY is not set',
    'Optional — but image generation and pdf/audio/video input need it. ' +
      'Get one at https://aistudio.google.com/apikey',
  );
} else {
  const res = await get(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}&pageSize=1`,
  );
  if (res.ok) pass('API key works');
  else if (res.status === 0) fail(`Cannot reach the Gemini API (${res.error})`, 'Check network access to Google.');
  else fail(`API key rejected (${res.status})`, res.body?.error?.message?.slice(0, 120));
}

/* ------------------------------------------------------------ Cloudflare */

// Verified by listing the account's models rather than by generating one, so a
// check does not spend part of the daily free allocation.
console.log('\n  Cloudflare Workers AI (images)');
const cfToken = process.env.CLOUDFLARE_API_TOKEN;
const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!cfToken || !cfAccount) {
  warn(
    'CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not set',
    'Text-to-image needs these — Gemini image models are quota 0 without billing.',
  );
} else {
  const res = await get(
    `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/models/search?per_page=500`,
    { Authorization: `Bearer ${cfToken}` },
  );
  if (res.ok) {
    const ids = new Set((res.body?.result || []).map((m) => m.name));
    const { MODELS } = await import('./models.js');
    const wanted = MODELS.filter((m) => m.provider === 'cloudflare');
    const missing = wanted.filter((m) => !ids.has(m.id)).map((m) => m.id);
    if (missing.length) {
      fail(
        `Credentials work, but ${missing.length} model id${missing.length === 1 ? '' : 's'} not on this account`,
        `Update server/models.js: ${missing.join(', ')}`,
      );
    } else {
      pass(`Credentials work, all ${wanted.length} image model ids exist`);
    }
  } else if (res.status === 0) {
    fail(`Cannot reach the Cloudflare API (${res.error})`, 'Check network access to api.cloudflare.com.');
  } else if (res.status === 401 || res.status === 403) {
    fail(
      `Credentials rejected (${res.status})`,
      'Check the account id, and that the token has the "Workers AI" permission.',
    );
  } else {
    fail(`Cloudflare API returned ${res.status}`, JSON.stringify(res.body?.errors || '').slice(0, 120));
  }
}

if (!groqKey && !geminiKey) {
  fail(
    'No chat provider key at all',
    'Set at least GROQ_API_KEY — the app cannot answer anything without one.',
  );
}

/* -------------------------------------------------------------- Supabase */

console.log('\n  Supabase');
const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const anonKey = process.env.SUPABASE_ANON_KEY || '';

if (!url || !anonKey) {
  fail(
    'SUPABASE_URL / SUPABASE_ANON_KEY are not set',
    'Sign-in is required, so the app will only show a setup screen until these exist.',
  );
} else if (/service_role|sb_secret/.test(anonKey)) {
  fail(
    'SUPABASE_ANON_KEY looks like a secret key',
    'Use the publishable / anon key. This app never needs the service_role key.',
  );
} else {
  pass(`Project ${url}`);

  // 1. Auth reachable, and is Google switched on?
  const settings = await get(`${url}/auth/v1/settings`, { apikey: anonKey });
  if (!settings.ok) {
    fail(
      `Auth API unreachable (${settings.status || settings.error})`,
      'Check the project URL and that the key belongs to this project.',
    );
  } else {
    pass('Auth API reachable, key accepted');
    if (settings.body?.external?.google) {
      pass('Google provider is enabled');
    } else {
      fail(
        'Google provider is NOT enabled',
        'Supabase → Authentication → Providers → Google. Paste a Google Cloud OAuth ' +
          `client whose redirect URI is ${url}/auth/v1/callback`,
      );
    }
  }

  // 2. Token verification depends on this endpoint.
  const jwks = await get(`${url}/auth/v1/.well-known/jwks.json`);
  if (jwks.ok && jwks.body?.keys?.length) {
    pass(`JWKS published (${jwks.body.keys.length} key, ${jwks.body.keys[0].alg})`);
  } else {
    warn(
      'No JWKS keys published — legacy HS256 project',
      'Still supported: the server will verify sessions via the Auth API instead.',
    );
  }

  // 3. Has the migration been run?
  for (const table of ['chats', 'messages']) {
    const probe = await get(`${url}/rest/v1/${table}?select=id&limit=1`, { apikey: anonKey });
    if (probe.status === 404 || probe.body?.code === 'PGRST205') {
      fail(
        `Table public.${table} is missing`,
        'Run supabase/migrations/0001_init.sql in the Supabase SQL editor.',
      );
    } else if (probe.ok) {
      const rows = Array.isArray(probe.body) ? probe.body.length : 0;
      pass(
        `Table public.${table} exists` +
          (rows === 0 ? ' (RLS correctly returns nothing to an anonymous caller)' : ''),
      );
    } else {
      warn(`Could not check public.${table} (${probe.status})`, probe.body?.message?.slice(0, 120));
    }
  }

  // 4. Media bucket. Anonymous callers cannot list buckets, so a 400/401 here
  //    is expected and only a 404 is meaningful.
  const bucket = await get(`${url}/storage/v1/object/list/chat-media`, { apikey: anonKey });
  if (bucket.status === 404) {
    fail(
      'Storage bucket "chat-media" is missing',
      'It is created by the migration — re-run supabase/migrations/0001_init.sql.',
    );
  } else {
    pass('Storage endpoint reachable (bucket verified at first upload)');
  }
}

console.log(
  failures === 0
    ? '\n  \x1b[32mAll checks passed — run `npm start` and sign in.\x1b[0m\n'
    : `\n  \x1b[31m${failures} thing${failures === 1 ? '' : 's'} still to fix (see above).\x1b[0m\n`,
);

process.exit(failures === 0 ? 0 : 1);
