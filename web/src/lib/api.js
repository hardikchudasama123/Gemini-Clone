async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Thrown when the server rejects our session, so the UI can sign out. */
export class SessionExpiredError extends Error {
  constructor(message) {
    super(message || 'Your session has expired. Sign in again.');
    this.name = 'SessionExpiredError';
  }
}

async function guard(res) {
  if (res.status === 401) {
    const data = await readJson(res);
    throw new SessionExpiredError(data?.message);
  }
}

export async function fetchModels(token) {
  const res = await fetch('/api/models', { headers: authHeaders(token) });
  await guard(res);
  if (!res.ok) throw new Error('Could not load models.');
  return res.json();
}

export async function fetchTitle(text, token) {
  try {
    const res = await fetch('/api/title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ text }),
    });
    if (res.status === 401) return null;
    const data = await readJson(res);
    return data?.title || null;
  } catch {
    return null;
  }
}

/**
 * POST /api/chat and dispatch each normalized SSE event to `onEvent`.
 * Rejects with an AbortError if `signal` fires.
 */
export async function streamChat({ model, messages, searchGrounding, token }, onEvent, signal) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ model, messages, searchGrounding }),
    signal,
  });

  await guard(res);

  if (!res.ok) {
    const data = await readJson(res);
    throw new Error(data?.message || `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line) => {
    if (!line.startsWith('data:')) return;
    const raw = line.slice(5).trim();
    if (!raw) return;
    try {
      onEvent(JSON.parse(raw));
    } catch {
      /* ignore partial frames */
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      handleLine(line);
    }
  }
  if (buffer.trim()) handleLine(buffer.trim());
}
