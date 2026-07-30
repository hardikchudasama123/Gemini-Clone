const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 502;
  }
}

/**
 * `fetch` reports every transport problem as a bare "fetch failed", which tells
 * a user nothing. Translate the underlying cause into something actionable.
 */
export function describeNetworkError(error) {
  const code = error?.cause?.code || error?.code;

  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Cannot resolve generativelanguage.googleapis.com — check this machine\'s DNS.';
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return (
        'Timed out connecting to the Gemini API. Outbound access to Google is being blocked — ' +
        'if this is running in Docker, a VPN or filtering client on the host (for example ' +
        'Cloudflare WARP) is likely dropping container traffic.'
      );
    case 'ECONNREFUSED':
      return 'Connection to the Gemini API was refused. Check any proxy or firewall on this machine.';
    case 'ECONNRESET':
      return 'The connection to the Gemini API was reset. Try again.';
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return 'TLS verification failed — a network appliance may be intercepting HTTPS traffic.';
    default:
      return code
        ? `Could not reach the Gemini API (${code}).`
        : 'Could not reach the Gemini API.';
  }
}

function apiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError('GEMINI_API_KEY is not set on the server.', 500);
  return key;
}

/**
 * Coalesce streamed parts into a replayable `contents` entry.
 *
 * Gemini 3 requires `thoughtSignature` to be echoed back on subsequent turns,
 * so parts carrying one are kept verbatim instead of being merged away.
 */
class PartAccumulator {
  constructor() {
    this.parts = [];
  }

  push(part) {
    const plainText =
      typeof part.text === 'string' && !part.thoughtSignature && !part.inlineData;
    const last = this.parts[this.parts.length - 1];
    const lastPlain =
      last && typeof last.text === 'string' && !last.thoughtSignature && !last.inlineData;

    if (plainText && lastPlain) {
      last.text += part.text;
      return;
    }
    this.parts.push({ ...part });
  }

  value() {
    return this.parts.filter((p) => p.inlineData || p.thoughtSignature || p.text !== '');
  }
}

function buildBody({ messages, model, systemInstruction, temperature, searchGrounding, isImageModel }) {
  const body = {
    contents: messages,
    generationConfig: {},
  };

  if (typeof temperature === 'number') {
    body.generationConfig.temperature = temperature;
  }

  if (isImageModel) {
    // Image models must be told to return image data alongside text.
    body.generationConfig.responseModalities = ['TEXT', 'IMAGE'];
  } else {
    body.generationConfig.thinkingConfig = { includeThoughts: true };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    if (searchGrounding) {
      body.tools = [{ googleSearch: {} }];
    }
  }

  return body;
}

/**
 * A 429 whose quota violation reports `limit: 0` means the key has no allowance
 * for that model whatsoever — a billing state, not a transient burst. Google
 * still attaches a "Please retry in 42s" hint to these, which is misleading.
 */
function isZeroQuota(detail) {
  return /limit:\s*0\b/.test(detail || '');
}

/** Turn an upstream failure into something worth showing a user. */
async function readError(res) {
  let detail = '';
  try {
    const data = await res.json();
    detail = data?.error?.message || '';
  } catch {
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
  }

  if (res.status === 429) {
    // A `limit: 0` violation is not a rate limit — the key has no allowance for
    // this model at all, and no amount of waiting changes that. Telling the user
    // to "wait a moment" here would send them in circles.
    if (isZeroQuota(detail)) {
      return (
        'This model is not included in your API key\'s free tier (quota is 0), so it cannot ' +
        'run until billing is enabled on the Google Cloud project behind the key. ' +
        'See https://ai.google.dev/gemini-api/docs/rate-limits — text models still work.'
      );
    }
    return (
      'Rate limit reached on this API key. The free tier allows only a few requests per minute ' +
      'for Pro models — wait a moment, or switch to a Flash model.'
    );
  }
  if (res.status === 503) {
    return 'This model is busy right now. Try again in a moment, or pick another model.';
  }
  if (res.status === 404) {
    return detail || 'That model is not available to this API key.';
  }
  if (res.status === 400 && /API key/i.test(detail)) {
    return 'The GEMINI_API_KEY looks invalid. Check the value in your .env file.';
  }

  return detail || `Gemini API returned ${res.status}`;
}

const RETRY_STATUSES = new Set([429, 503]);

/**
 * POST once, retrying transient rate-limit / overload responses.
 * Safe to retry because nothing has been streamed to the client yet.
 */
async function postWithRetry(url, body, signal, attempts = 3) {
  let lastResponse = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (res.ok) return res;

    lastResponse = res;
    if (!RETRY_STATUSES.has(res.status) || attempt === attempts - 1) break;

    // Read the body so the socket is released before sleeping.
    const text = await res.clone().text().catch(() => '');

    // A zero quota cannot recover, so retrying only makes the user wait ~30s
    // for the same failure. Surface it immediately instead.
    if (isZeroQuota(text)) break;

    const suggested = Number(/retry in ([\d.]+)s/i.exec(text)?.[1]);
    const delay = Number.isFinite(suggested)
      ? Math.min(suggested * 1000 + 250, 15000)
      : 1200 * 2 ** attempt;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
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

/**
 * Stream a completion, invoking `onEvent` with normalized events:
 *   { type: 'thought' | 'text', text }
 *   { type: 'image', mimeType, data }
 *   { type: 'sources', items }
 *   { type: 'usage', ... }
 *   { type: 'done', parts, finishReason }
 */
export async function streamChat(options, onEvent, signal) {
  const { model, isImageModel } = options;
  const url = `${API_ROOT}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${apiKey()}`;

  const res = await postWithRetry(url, buildBody(options), signal);

  if (!res?.ok) throw new GeminiError(await readError(res), res?.status);

  const accumulator = new PartAccumulator();
  const seenSources = new Map();
  const decoder = new TextDecoder();
  const reader = res.body.getReader();

  let buffer = '';
  let finishReason = null;
  let usage = null;

  const handleChunk = (payload) => {
    const candidate = payload?.candidates?.[0];
    if (payload?.usageMetadata) usage = payload.usageMetadata;
    if (candidate?.finishReason) finishReason = candidate.finishReason;

    for (const part of candidate?.content?.parts ?? []) {
      if (part.thought) {
        if (part.text) onEvent({ type: 'thought', text: part.text });
        // Thought text itself is not replayed, but its signature must be.
        if (part.thoughtSignature) {
          accumulator.push({ text: '', thought: true, thoughtSignature: part.thoughtSignature });
        }
        continue;
      }

      accumulator.push(part);

      if (part.inlineData) {
        onEvent({
          type: 'image',
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data,
        });
      } else if (part.text) {
        onEvent({ type: 'text', text: part.text });
      }
    }

    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const fresh = [];
    for (const chunk of chunks) {
      const web = chunk.web;
      if (!web?.uri || seenSources.has(web.uri)) continue;
      const item = { uri: web.uri, title: web.title || web.uri, domain: web.domain || '' };
      seenSources.set(web.uri, item);
      fresh.push(item);
    }
    if (fresh.length) onEvent({ type: 'sources', items: fresh });
  };

  const flushLine = (line) => {
    if (!line.startsWith('data:')) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') return;
    try {
      handleChunk(JSON.parse(raw));
    } catch {
      /* skip malformed keep-alive noise */
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
      flushLine(line);
    }
  }
  if (buffer.trim()) flushLine(buffer.trim());

  if (usage) {
    onEvent({
      type: 'usage',
      promptTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
      thoughtTokens: usage.thoughtsTokenCount ?? 0,
      totalTokens: usage.totalTokenCount ?? 0,
    });
  }

  onEvent({ type: 'done', parts: accumulator.value(), finishReason });
}

/** One-shot, non-streaming generation — used for chat titles. */
export async function generateText({ model, prompt, maxOutputTokens = 200 }) {
  const url = `${API_ROOT}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey()}`;
  const res = await postWithRetry(
    url,
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens,
        temperature: 0.3,
        // Thinking is disabled outright: a small token cap would otherwise be
        // spent entirely on thoughts, leaving no text in the response.
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    undefined,
    2,
  );

  if (!res?.ok) throw new GeminiError(await readError(res), res?.status);

  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join('')
    .trim();
}
