/**
 * Cloudflare Workers AI provider — text-to-image only.
 *
 * Exists because image generation has a quota of 0 on a free Gemini key, so the
 * Nano Banana models cannot run without billing enabled. Workers AI generates
 * on its free allocation, which makes text-to-image work out of the box.
 *
 * Emits the same normalized events as the other providers:
 *   { type: 'image', mimeType, data }
 *   { type: 'done', parts, finishReason }
 *
 * There is no streaming endpoint for these models, so the image arrives in one
 * piece and is emitted as a single event. The SSE contract with the browser is
 * unchanged either way.
 */
import { GeminiError } from './gemini.js';

const API_ROOT = 'https://api.cloudflare.com/client/v4/accounts';

export function cloudflareConfigured() {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
}

function credentials() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    throw new GeminiError(
      'CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not set on the server.',
      500,
    );
  }
  return { token, account };
}

export function describeCloudflareNetworkError(error) {
  const code = error?.cause?.code || error?.code;
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return "Cannot resolve api.cloudflare.com — check this machine's DNS.";
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return (
        'Timed out connecting to Cloudflare Workers AI. Outbound access is being blocked — if ' +
        'this is running in Docker, a VPN or filtering client on the host (for example ' +
        'Cloudflare WARP) is likely dropping container traffic.'
      );
    case 'ECONNREFUSED':
      return 'Connection to Cloudflare Workers AI was refused. Check any proxy or firewall.';
    case 'ECONNRESET':
      return 'The connection to Cloudflare Workers AI was reset. Try again.';
    default:
      return code
        ? `Could not reach Cloudflare Workers AI (${code}).`
        : 'Could not reach Cloudflare Workers AI.';
  }
}

/* ------------------------------------------------------------------ prompt */

/**
 * These models are text-to-image: they take a prompt string and have no notion
 * of a conversation, so only the newest user turn can be honoured. Earlier turns
 * are deliberately dropped rather than concatenated — folding an old prompt into
 * a new one produces an image matching neither.
 */
function promptFromMessages(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
    const entry = messages[i];
    if (entry?.role === 'model') continue;

    const text = (entry.parts || [])
      .filter((part) => !part.thought && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();

    if (text) return text;
  }
  throw new GeminiError('Describe the image you want in a message first.', 400);
}

/* -------------------------------------------------------------------- mime */

/**
 * Workers AI does not label the base64 it returns, and it is not always PNG —
 * flux-1-schnell hands back JPEG. The browser uses this value for both the data
 * URI and the download filename, so it is sniffed from the magic bytes instead
 * of assumed.
 */
function sniffMimeType(buffer) {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.length > 12 && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return 'image/png';
}

/* ------------------------------------------------------------------ errors */

async function readError(res) {
  let detail = '';
  try {
    const data = await res.json();
    detail = (data?.errors || []).map((e) => e.message).filter(Boolean).join('; ');
  } catch {
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
  }

  if (res.status === 401 || res.status === 403) {
    return (
      'Cloudflare rejected the credentials. Check CLOUDFLARE_API_TOKEN and ' +
      'CLOUDFLARE_ACCOUNT_ID, and that the token has the "Workers AI" read permission.'
    );
  }
  if (res.status === 404) {
    return 'That image model is not available on this Cloudflare account.';
  }
  if (res.status === 429) {
    return (
      'Cloudflare Workers AI daily free allocation is used up. It resets each day — ' +
      'or enable Workers Paid on the account for more.'
    );
  }
  return detail || `Cloudflare Workers AI returned ${res.status}`;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503]);

async function postWithRetry(model, body, signal, attempts = 2) {
  const { token, account } = credentials();
  let lastResponse = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await fetch(`${API_ROOT}/${account}/ai/run/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (res.ok) return res;

    lastResponse = res;
    // A used-up daily allocation will not recover on a retry.
    if (res.status === 429 || !RETRY_STATUSES.has(res.status) || attempt === attempts - 1) break;

    await res.text().catch(() => '');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1500 * 2 ** attempt);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  }

  return lastResponse;
}

/* --------------------------------------------------------------- streaming */

export async function streamChat(options, onEvent, signal) {
  const { model, messages, prompt: override } = options;
  // The router passes a rewritten prompt when it auto-routes a chat message.
  const prompt = override || promptFromMessages(messages);

  const res = await postWithRetry(model, { prompt }, signal);
  if (!res?.ok) throw new GeminiError(await readError(res), res?.status);

  // Two response shapes in the same API: flux-1-schnell answers with JSON
  // carrying base64, while the diffusion models stream raw image bytes.
  const contentType = res.headers.get('content-type') || '';
  let data;

  if (contentType.includes('application/json')) {
    const body = await res.json();
    const base64 = body?.result?.image;
    if (typeof base64 !== 'string' || !base64) {
      throw new GeminiError('Cloudflare returned no image for that prompt.', 502);
    }
    data = base64;
  } else {
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) throw new GeminiError('Cloudflare returned an empty image.', 502);
    data = buffer.toString('base64');
  }

  const mimeType = sniffMimeType(Buffer.from(data, 'base64'));

  onEvent({ type: 'image', mimeType, data });

  // `done.parts` is what the browser replays as context on the next turn, and
  // the image itself is already persisted from the event above. Replaying the
  // base64 would resend a megabyte of image on every later message — and to a
  // text model, which cannot use it — so the turn is summarised as text.
  onEvent({
    type: 'done',
    parts: [{ text: `[generated an image of: ${prompt}]` }],
    finishReason: 'STOP',
  });
}

/**
 * Present only to satisfy the provider contract. Titles never route here — the
 * catalogue marks these models image-only and `titleModel()` picks a text model.
 */
export async function generateText() {
  throw new GeminiError('Cloudflare Workers AI is only configured for image generation.', 500);
}
