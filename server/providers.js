// Model providers. Every provider exposes the same thing: an async generator of
// text chunks for (model, system, messages). Model ids are "provider:model".
//
//   claude:     Anthropic API        (ANTHROPIC_API_KEY)
//   nous:       Nous Research API, hosted Hermes, has a free tier (NOUS_API_KEY)
//   ollama:     local models, free   (OLLAMA_URL, default http://localhost:11434) e.g. Hermes 3
//   openrouter: hosted open models   (OPENROUTER_API_KEY, OPENROUTER_MODELS)
//   custom:     any OpenAI-compatible endpoint (OPENAI_COMPAT_URL, _KEY, _MODELS, _NAME),
//               e.g. LM Studio, vLLM, llama.cpp server, or an agent that serves that API

import Anthropic from '@anthropic-ai/sdk';

const env = (k, d = '') => process.env[k] || d;
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- Claude

const CLAUDE_MODELS = [
  { model: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { model: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

let anthropic;
const claudeReady = () => Boolean(env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN'));

function claudeParams(model) {
  // Haiku 4.5 predates adaptive thinking and effort; newer models use both.
  if (model === 'claude-haiku-4-5') return {};
  return {
    thinking: { type: 'adaptive' },
    output_config: { effort: env('TENNEX_EFFORT', 'low') },
    // If a safety classifier declines, let the API re-route to its recommended fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
}

async function* streamClaude({ model, system, messages, signal }) {
  anthropic ??= new Anthropic();
  const stream = anthropic.beta.messages.stream(
    {
      model,
      max_tokens: 64000,
      cache_control: { type: 'ephemeral' },
      system,
      messages,
      ...claudeParams(model),
    },
    { signal },
  );
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') throw new ProviderError('The agent declined that request.');
}

// ---------------------------------------------------------------- OpenAI-compatible (Ollama, OpenRouter, custom)

export class ProviderError extends Error {}

function openAIProviders() {
  const out = {
    ollama: { name: 'Ollama (local)', base: `${env('OLLAMA_URL', 'http://localhost:11434').replace(/\/$/, '')}/v1`, key: '' },
  };
  if (env('NOUS_API_KEY')) {
    out.nous = {
      name: 'Nous Research (Hermes)',
      base: env('NOUS_BASE_URL', 'https://inference-api.nousresearch.com/v1').replace(/\/$/, ''),
      key: env('NOUS_API_KEY'),
      // Asked from the API's /models when possible; this list is only the fallback.
      models: list(env('NOUS_MODELS', 'Hermes-4-70B,Hermes-4-405B')),
      discover: !env('NOUS_MODELS'),
    };
  }
  if (env('OPENROUTER_API_KEY')) {
    out.openrouter = {
      name: 'OpenRouter',
      base: 'https://openrouter.ai/api/v1',
      key: env('OPENROUTER_API_KEY'),
      models: list(env('OPENROUTER_MODELS', 'nousresearch/hermes-3-llama-3.1-405b')),
      headers: { 'HTTP-Referer': 'https://github.com/elvinlearning/tennex_dev', 'X-Title': 'Tennex' },
    };
  }
  if (env('OPENAI_COMPAT_URL')) {
    out.custom = {
      name: env('OPENAI_COMPAT_NAME', 'Custom'),
      base: env('OPENAI_COMPAT_URL').replace(/\/$/, ''),
      key: env('OPENAI_COMPAT_KEY'),
      models: list(env('OPENAI_COMPAT_MODELS', 'default')),
      discover: !env('OPENAI_COMPAT_MODELS'),
    };
  }
  return out;
}

// Reasoning models (Hermes 4, DeepSeek, Qwen...) may think inline in <think> tags.
// Strip that so it never reaches the agent's voice or screen.
export class ThinkFilter {
  constructor() {
    this.buf = '';
    this.inThink = false;
  }
  push(text) {
    this.buf += text;
    let out = '';
    for (;;) {
      const tag = this.inThink ? '</think>' : '<think>';
      const i = this.buf.indexOf(tag);
      if (i !== -1) {
        if (!this.inThink) out += this.buf.slice(0, i);
        this.buf = this.buf.slice(i + tag.length);
        this.inThink = !this.inThink;
        continue;
      }
      // keep a possible partial tag at the end for the next chunk
      let keep = 0;
      for (let n = Math.min(tag.length - 1, this.buf.length); n > 0; n--) {
        if (tag.startsWith(this.buf.slice(-n))) {
          keep = n;
          break;
        }
      }
      if (!this.inThink) out += this.buf.slice(0, this.buf.length - keep);
      this.buf = this.buf.slice(this.buf.length - keep);
      return out;
    }
  }
  end() {
    const rest = this.inThink ? '' : this.buf;
    this.buf = '';
    return rest;
  }
}

async function* streamOpenAI(p, { model, system, messages, signal }) {
  const res = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(p.key ? { authorization: `Bearer ${p.key}` } : {}),
      ...(p.headers ?? {}),
    },
    body: JSON.stringify({ model, stream: true, max_tokens: 4096, messages: [{ role: 'system', content: system }, ...messages] }),
    signal,
  }).catch((err) => {
    if (err.name === 'AbortError') throw err;
    throw new ProviderError(`Could not reach ${p.name} at ${p.base}. Is it running?`);
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new ProviderError(`${p.name} returned ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  const filter = new ThinkFilter();
  const decoder = new TextDecoder();
  let buf = '';
  for await (const bytes of res.body) {
    buf += decoder.decode(bytes, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') break;
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error) throw new ProviderError(`${p.name}: ${json.error.message ?? JSON.stringify(json.error)}`);
      const text = json.choices?.[0]?.delta?.content;
      if (text) {
        const visible = filter.push(text);
        if (visible) yield visible;
      }
    }
  }
  const tail = filter.end();
  if (tail) yield tail;
}

// ---------------------------------------------------------------- catalog

let ollamaCache = { at: 0, models: [] };

async function ollamaModels(base) {
  if (Date.now() - ollamaCache.at < 15_000) return ollamaCache.models;
  let models = [];
  try {
    const res = await fetch(base.replace(/\/v1$/, '/api/tags'), { signal: AbortSignal.timeout(1500) });
    if (res.ok) models = ((await res.json()).models ?? []).map((m) => m.name);
  } catch {
    // Ollama isn't running: that's fine, just offer nothing from it.
  }
  ollamaCache = { at: Date.now(), models };
  return models;
}

// OpenAI-compatible servers list their models at GET /models. Use that so
// nobody has to guess exact model names; fall back to the configured list.
const discovered = new Map();
async function discoverModels(key, p) {
  const hit = discovered.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.models;
  let models = p.models;
  try {
    const res = await fetch(`${p.base}/models`, {
      headers: p.key ? { authorization: `Bearer ${p.key}` } : {},
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const ids = ((await res.json()).data ?? []).map((m) => m.id).filter(Boolean);
      if (ids.length) models = ids;
    }
  } catch {
    // unreachable right now: keep the configured list
  }
  discovered.set(key, { at: Date.now(), models });
  return models;
}

// [{ id: 'provider:model', label, provider }]
export async function listModels() {
  const out = [];
  if (claudeReady()) for (const m of CLAUDE_MODELS) out.push({ id: `claude:${m.model}`, label: m.label, provider: 'Claude' });
  const providers = openAIProviders();
  for (const name of await ollamaModels(providers.ollama.base)) out.push({ id: `ollama:${name}`, label: name, provider: providers.ollama.name });
  for (const key of ['nous', 'openrouter', 'custom']) {
    const p = providers[key];
    if (!p) continue;
    const models = p.discover ? await discoverModels(key, p) : p.models;
    for (const m of models) out.push({ id: `${key}:${m}`, label: m, provider: p.name });
  }
  return out;
}

export function streamModel(id, args) {
  const i = id.indexOf(':');
  const provider = id.slice(0, i);
  const model = id.slice(i + 1);
  if (provider === 'claude') return streamClaude({ model, ...args });
  const p = openAIProviders()[provider];
  if (!p) throw new ProviderError(`Unknown provider: ${provider}`);
  return streamOpenAI(p, { model, ...args });
}
