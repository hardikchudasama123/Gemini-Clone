/**
 * Curated model catalogue across providers.
 *
 * `id` is what the browser and the database store, and must stay stable —
 * existing chat rows reference it. For Groq it is also the upstream model name;
 * for Gemini it is the Gemini API model name.
 *
 * Capability flags, all verified against the live APIs rather than assumed:
 *   thinking  exposes a reasoning stream for the "Thoughts" panel
 *   image     GENERATES images
 *   vision    ACCEPTS image input
 *   files     ACCEPTS pdf / audio / video input
 *   search    supports web-search grounding with cited sources
 */
export const MODELS = [
  /* ------------------------------------------------------------------ groq */
  // Fast and generous on request count, which is why these are the default.
  // The tradeoff is a low tokens-per-minute ceiling — see README.
  {
    id: 'openai/gpt-oss-120b',
    provider: 'groq',
    name: 'GPT-OSS 120B',
    blurb: 'Strong reasoning, very fast',
    thinking: true,
    tier: 'pro',
  },
  {
    id: 'openai/gpt-oss-20b',
    provider: 'groq',
    name: 'GPT-OSS 20B',
    blurb: 'Lighter reasoning, lower latency',
    thinking: true,
    tier: 'fast',
  },
  {
    id: 'qwen/qwen3.6-27b',
    provider: 'groq',
    name: 'Qwen 3.6 27B',
    blurb: 'Reasoning, and the only Groq model here that reads images',
    thinking: true,
    vision: true,
    tier: 'fast',
  },
  {
    id: 'llama-3.3-70b-versatile',
    provider: 'groq',
    name: 'Llama 3.3 70B',
    blurb: 'Capable all-rounder, no reasoning stream',
    tier: 'pro',
  },
  {
    id: 'llama-3.1-8b-instant',
    provider: 'groq',
    name: 'Llama 3.1 8B',
    blurb: 'Fastest and highest daily limit',
    tier: 'lite',
  },
  {
    id: 'groq/compound',
    provider: 'groq',
    name: 'Compound',
    blurb: 'Answers from live web search, with sources',
    // Search is built into the model rather than toggled per request.
    search: true,
    alwaysSearch: true,
    tier: 'pro',
  },

  /* ------------------------------------------------------------ cloudflare */
  // Text-to-image on Workers AI's free allocation. Gemini's image models need
  // billing enabled (free-tier quota is 0), so these are the ones that actually
  // generate on a free setup.
  {
    id: '@cf/black-forest-labs/flux-1-schnell',
    provider: 'cloudflare',
    name: 'FLUX.1 Schnell',
    blurb: 'Generate images, free and fast',
    image: true,
    tier: 'image',
  },
  {
    id: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    provider: 'cloudflare',
    name: 'Stable Diffusion XL',
    blurb: 'Alternative image style',
    image: true,
    tier: 'image',
  },

  /* ---------------------------------------------------------------- gemini */
  // Kept for image generation and for pdf/audio/video input, which Groq
  // cannot do at all. The image models below need billing on the key.
  {
    id: 'gemini-3.6-flash',
    provider: 'gemini',
    name: '3.6 Flash',
    blurb: 'Fast all-rounder for everyday help',
    thinking: true,
    vision: true,
    files: true,
    search: true,
    tier: 'fast',
  },
  {
    id: 'gemini-3.1-pro-preview',
    provider: 'gemini',
    name: '3.1 Pro',
    blurb: 'Best for complex reasoning and code',
    thinking: true,
    vision: true,
    files: true,
    search: true,
    tier: 'pro',
  },
  {
    id: 'gemini-3.5-flash',
    provider: 'gemini',
    name: '3.5 Flash',
    blurb: 'Balanced speed and quality',
    thinking: true,
    vision: true,
    files: true,
    search: true,
    tier: 'fast',
  },
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    name: '3.1 Flash Lite',
    blurb: 'Lowest latency, lightest tasks',
    thinking: true,
    vision: true,
    files: true,
    search: true,
    tier: 'lite',
  },
  {
    id: 'gemini-2.5-pro',
    provider: 'gemini',
    name: '2.5 Pro',
    blurb: 'Previous-generation reasoning model',
    thinking: true,
    vision: true,
    files: true,
    search: true,
    tier: 'pro',
  },
  // `needsBilling` verified against a live free key: these answer 429 with
  // `limit: 0` on generate_content_free_tier_requests. They stay in the picker
  // because they work the moment billing is enabled, but nothing recommends them.
  {
    id: 'gemini-3-pro-image',
    provider: 'gemini',
    name: 'Nano Banana Pro',
    blurb: 'Generate and edit images (needs billing)',
    thinking: true,
    image: true,
    vision: true,
    needsBilling: true,
    tier: 'image',
  },
  {
    id: 'gemini-3.1-flash-image',
    provider: 'gemini',
    name: 'Nano Banana 2',
    blurb: 'Fast image generation (needs billing)',
    thinking: true,
    image: true,
    vision: true,
    needsBilling: true,
    tier: 'image',
  },
];

export const PROVIDER_LABEL = {
  groq: 'Groq',
  gemini: 'Google Gemini',
  cloudflare: 'Cloudflare Workers AI',
};

/** Which providers actually have a key on this server. */
export function configuredProviders() {
  return {
    groq: Boolean(process.env.GROQ_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    // Workers AI needs both an account id and a token to address an endpoint.
    cloudflare: Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID),
  };
}

/** Only offer models the server can actually reach. */
export function availableModels() {
  const configured = configuredProviders();
  return MODELS.filter((model) => configured[model.provider]);
}

export function findModel(id) {
  return MODELS.find((m) => m.id === id);
}

/**
 * Image models worth pointing a user at — free-to-run ones first. Recommending a
 * `needsBilling` model to someone who has not enabled billing just sends them
 * into an error, so those are only offered when nothing else can draw.
 */
export function suggestedImageModels() {
  const images = availableModels().filter((m) => m.image);
  const free = images.filter((m) => !m.needsBilling);
  return free.length ? free : images;
}

/**
 * Prefer Groq for everyday chat — its per-day request allowance is far higher
 * than Gemini's free tier, which is the whole reason it was added. Falls back
 * to Gemini when only that key is present.
 */
export function defaultModel() {
  const available = availableModels();
  const preferred = ['openai/gpt-oss-120b', 'gemini-3.6-flash'];
  for (const id of preferred) {
    if (available.some((m) => m.id === id)) return id;
  }
  // Never open a new chat on an image generator: with only an image provider
  // configured it would be first in the list, and every message would draw.
  const chat = available.find((m) => !m.image);
  return chat?.id || available[0]?.id || MODELS[0].id;
}

/**
 * Titles need a cheap, non-reasoning model: with a small token cap a reasoning
 * model spends the entire budget thinking and returns no text at all.
 */
export function titleModel() {
  const configured = configuredProviders();
  if (configured.groq) return 'llama-3.1-8b-instant';
  if (configured.gemini) return 'gemini-3.1-flash-lite';
  return null;
}
