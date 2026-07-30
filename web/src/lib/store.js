const PREFS_KEY = 'gemini-clone.prefs.v1';

export function uid() {
  // Storage paths and primary keys both use this, and chats.id / messages.id are
  // `uuid` columns, so a non-UUID here is not a cosmetic difference — Postgres
  // rejects the insert outright. randomUUID is secure-context-only, so it is
  // absent over plain HTTP on a bare IP; getRandomValues carries no such
  // restriction and builds the same thing by hand.
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/* ------------------------------------------------------------------ prefs */

// Only UI preferences stay local now; conversations live in Postgres.

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* non-critical */
  }
}

/* ------------------------------------------------------------------ chats */

/**
 * A chat that exists only in memory until its first message is sent.
 *
 * A `temporary` chat is never persisted at all: it skips every database write,
 * stays out of the sidebar, and is discarded on reload or when another chat is
 * opened.
 */
export function createDraftChat(model, { temporary = false } = {}) {
  const now = Date.now();
  return {
    id: uid(),
    title: temporary ? 'Temporary chat' : 'New chat',
    titleLocked: temporary,
    model,
    createdAt: now,
    updatedAt: now,
    messages: [],
    loaded: true,
    persisted: false,
    temporary,
  };
}

/* --------------------------------------------------------- api conversion */

/**
 * Convert stored messages into Gemini `contents`.
 * Model turns replay their raw parts so thought signatures survive.
 */
export function toGeminiContents(messages) {
  const contents = [];

  for (const message of messages) {
    if (message.error && message.role === 'model') continue;

    if (message.role === 'user') {
      const parts = [];
      for (const attachment of message.attachments || []) {
        if (attachment.data) {
          parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
        }
      }
      if (message.text?.trim()) parts.push({ text: message.text });
      if (parts.length) contents.push({ role: 'user', parts });
      continue;
    }

    const parts = message.parts?.length
      ? message.parts
      : message.text
        ? [{ text: message.text }]
        : [];
    if (parts.length) contents.push({ role: 'model', parts });
  }

  return contents;
}

export function groupChatsByDate(chats) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86400000;

  const buckets = new Map();
  const bucketFor = (timestamp) => {
    if (timestamp >= startOfToday) return 'Today';
    if (timestamp >= startOfToday - dayMs) return 'Yesterday';
    if (timestamp >= startOfToday - dayMs * 7) return 'Previous 7 days';
    if (timestamp >= startOfToday - dayMs * 30) return 'Previous 30 days';
    return 'Older';
  };

  for (const chat of chats) {
    const label = bucketFor(chat.updatedAt || chat.createdAt || 0);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(chat);
  }

  const order = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'];
  return order.filter((label) => buckets.has(label)).map((label) => [label, buckets.get(label)]);
}
