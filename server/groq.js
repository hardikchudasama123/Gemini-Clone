/**
 * Groq provider. Emits exactly the same normalized events as gemini.js, so the
 * SSE contract with the browser is unchanged:
 *   { type: 'thought' | 'text', text }
 *   { type: 'sources', items }
 *   { type: 'usage', ... }
 *   { type: 'done', parts, finishReason }
 *
 * Groq speaks the OpenAI chat-completions dialect, so the Gemini-shaped
 * `contents` the frontend sends are translated here rather than in the route.
 * That keeps the browser ignorant of which provider answered.
 */
import { GeminiError } from './gemini.js';

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export function groqConfigured() {
  return Boolean(process.env.GROQ_API_KEY);
}

function apiKey() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new GeminiError('GROQ_API_KEY is not set on the server.', 500);
  return key;
}

export function describeGroqNetworkError(error) {
  const code = error?.cause?.code || error?.code;
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return "Cannot resolve api.groq.com — check this machine's DNS.";
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return (
        'Timed out connecting to the Groq API. Outbound access is being blocked — if this is ' +
        'running in Docker, a VPN or filtering client on the host (for example Cloudflare WARP) ' +
        'is likely dropping container traffic.'
      );
    case 'ECONNREFUSED':
      return 'Connection to the Groq API was refused. Check any proxy or firewall on this machine.';
    case 'ECONNRESET':
      return 'The connection to the Groq API was reset. Try again.';
    default:
      return code ? `Could not reach the Groq API (${code}).` : 'Could not reach the Groq API.';
  }
}

/* ------------------------------------------------------------- translation */

/**
 * Gemini `contents` -> OpenAI `messages`.
 *
 * Text-only models reject the array form of `content` outright ("content must
 * be a string"), so images are only emitted for vision models and dropped with
 * a note otherwise — silently discarding them would make the model answer as
 * if the user had attached nothing.
 */
function toOpenAiMessages(contents, { systemInstruction, vision }) {
  const messages = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });

  for (const entry of contents || []) {
    const role = entry.role === 'model' ? 'assistant' : 'user';
    const texts = [];
    const images = [];

    for (const part of entry.parts || []) {
      if (part.inlineData?.data) {
        // Only images are representable here; Groq has no inline pdf/audio/video.
        if (/^image\//.test(part.inlineData.mimeType || '')) {
          images.push({
            type: 'image_url',
            image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` },
          });
        } else {
          texts.push(`[attachment omitted: ${part.inlineData.mimeType} is not supported by this model]`);
        }
        continue;
      }
      // Thought-signature placeholders carry no text worth replaying.
      if (part.thought) continue;
      if (typeof part.text === 'string' && part.text !== '') texts.push(part.text);
    }

    const text = texts.join('\n').trim();

    if (role === 'user' && vision && images.length) {
      messages.push({
        role,
        content: [...(text ? [{ type: 'text', text }] : []), ...images],
      });
      continue;
    }

    if (images.length && !vision) {
      texts.push('[image omitted: this model cannot read images]');
    }
    const flat = texts.join('\n').trim();
    if (flat) messages.push({ role, content: flat });
  }

  return messages;
}

/**
 * `groq/compound` reports what it searched in `executed_tools`, whose `output`
 * is a text blob of "Title: … URL: …" records rather than structured JSON.
 */
function sourcesFromExecutedTools(tools) {
  const items = [];
  for (const tool of tools || []) {
    const output = typeof tool?.output === 'string' ? tool.output : '';
    if (!output) continue;
    const pattern = /Title:\s*(.*?)\s*\n\s*URL:\s*(\S+)/g;
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const uri = match[2].trim();
      let domain = '';
      try {
        domain = new URL(uri).hostname.replace(/^www\./, '');
      } catch {
        /* a malformed URL still gets listed, just without a domain label */
      }
      items.push({ uri, title: (match[1] || uri).trim(), domain });
    }
  }
  return items;
}

/* ------------------------------------------------------------------ errors */

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
    return (
      detail ||
      'Groq rate limit reached. The free tier caps tokens per minute, which a long ' +
        'conversation can hit — start a new chat, or switch to Llama 3.1 8B.'
    );
  }
  if (res.status === 401 || res.status === 403) {
    return 'The GROQ_API_KEY was rejected. Check the value in your .env file.';
  }
  if (res.status === 413) {
    return 'This conversation is too large for the model. Start a new chat.';
  }
  if (res.status === 503) {
    return 'This model is busy right now. Try again in a moment, or pick another model.';
  }
  return detail || `Groq API returned ${res.status}`;
}

const RETRY_STATUSES = new Set([429, 503]);

async function postWithRetry(body, signal, attempts = 3) {
  let lastResponse = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (res.ok) return res;

    lastResponse = res;
    if (!RETRY_STATUSES.has(res.status) || attempt === attempts - 1) break;

    // Groq states how long to wait; prefer it over blind backoff.
    const retryAfter = Number(res.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000 + 250, 15000)
      : 1200 * 2 ** attempt;

    await res.text().catch(() => '');
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

/* ----------------------------------------------------------------- streaming */

export async function streamChat(options, onEvent, signal) {
  const { model, messages, systemInstruction, temperature, thinking, vision } = options;

  const body = {
    model,
    stream: true,
    messages: toOpenAiMessages(messages, { systemInstruction, vision }),
  };
  if (typeof temperature === 'number') body.temperature = temperature;
  // Only reasoning models accept this — llama-3.3-70b returns a hard 400.
  if (thinking) body.reasoning_format = 'parsed';

  const res = await postWithRetry(body, signal);
  if (!res?.ok) throw new GeminiError(await readError(res), res?.status);

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  const seenSources = new Set();

  let buffer = '';
  let text = '';
  let finishReason = null;
  let usage = null;

  const handleChunk = (payload) => {
    if (payload?.usage) usage = payload.usage;
    if (payload?.x_groq?.usage) usage = payload.x_groq.usage;

    const choice = payload?.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;

    const delta = choice.delta || {};
    if (typeof delta.reasoning === 'string' && delta.reasoning) {
      onEvent({ type: 'thought', text: delta.reasoning });
    }
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content;
      onEvent({ type: 'text', text: delta.content });
    }

    const tools = delta.executed_tools || choice.message?.executed_tools;
    if (tools) {
      const fresh = sourcesFromExecutedTools(tools).filter((item) => {
        if (seenSources.has(item.uri)) return false;
        seenSources.add(item.uri);
        return true;
      });
      if (fresh.length) onEvent({ type: 'sources', items: fresh });
    }
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
      promptTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      thoughtTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
    });
  }

  // No thought-signature equivalent exists, so the replayable turn is the
  // answer text alone.
  onEvent({
    type: 'done',
    parts: text ? [{ text }] : [],
    finishReason,
  });
}

/** One-shot, non-streaming generation — used for chat titles. */
export async function generateText({ model, prompt, maxOutputTokens = 200 }) {
  const res = await postWithRetry(
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_completion_tokens: maxOutputTokens,
    },
    undefined,
    2,
  );

  if (!res?.ok) throw new GeminiError(await readError(res), res?.status);

  const data = await res.json();
  return String(data?.choices?.[0]?.message?.content || '').trim();
}
