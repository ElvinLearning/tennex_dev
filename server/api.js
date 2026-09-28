// Tiny API for the office. Framework-free so it can run as Vite dev middleware
// and inside the plain Node production server.
//
//   GET  /api/health  -> { live, models: [{ id, label, provider }], defaultModel }
//   POST /api/chat    -> text/event-stream of { t } text deltas, then { done } or { error }

import Anthropic from '@anthropic-ai/sdk';
import { AGENT_BY_ID, systemPromptFor } from '../src/agents/roster.js';
import { listModels, streamModel, ProviderError } from './providers.js';

try {
  process.loadEnvFile?.('.env');
} catch {
  // no .env file: fine, fall back to the real environment
}

const MAX_BODY = 200_000;
const MAX_HISTORY = 24;
const MAX_TEXT = 8_000;

// TENNEX_MODEL picks the default brain, e.g. "claude:claude-opus-5-5" or "ollama:hermes3".
function defaultModel(models) {
  const want = process.env.TENNEX_MODEL;
  const hit = want && models.find((m) => m.id === want || m.id === `claude:${want}`);
  return (hit ?? models[0])?.id ?? null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const clip = (s, n = MAX_TEXT) => String(s ?? '').slice(0, n);

// Only trust the shape we expect from the browser; the agent persona is chosen
// server-side from the roster, never taken from the request.
export function buildMessages({ history = [], prompt, office = [], brief = '' }) {
  const messages = [];
  for (const m of history.slice(-MAX_HISTORY)) {
    if ((m?.role !== 'user' && m?.role !== 'assistant') || !m.content) continue;
    const last = messages[messages.length - 1];
    if (last?.role === m.role) last.content += `\n\n${clip(m.content)}`;
    else messages.push({ role: m.role, content: clip(m.content) });
  }
  while (messages[0]?.role === 'assistant') messages.shift();

  const feed = office.slice(-12).map((l) => `- ${clip(l, 300)}`).join('\n');
  const context = [];
  if (brief) context.push(`[Project brief]\n${clip(brief, 1500)}`);
  if (feed) context.push(`[Office feed, most recent last]\n${feed}`);
  context.push(`Human says: ${clip(prompt, 4000)}`);
  const content = context.join('\n\n');
  if (messages[messages.length - 1]?.role === 'user') messages.push({ role: 'assistant', content: '(listening)' });
  messages.push({ role: 'user', content });
  return messages;
}

async function handleChat(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, err.status || 400, { error: err.status ? err.message : 'Invalid JSON' });
  }
  const { agentId, prompt } = body ?? {};
  if (!AGENT_BY_ID[agentId]) return sendJson(res, 400, { error: 'Unknown agent' });
  if (!prompt || typeof prompt !== 'string') return sendJson(res, 400, { error: 'Missing prompt' });
  const models = await listModels();
  const model = body.model;
  if (!models.some((m) => m.id === model)) return sendJson(res, 400, { error: `Model not available: ${model}` });

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  // Stop paying for tokens nobody will see if the player walks away.
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());

  try {
    for await (const text of streamModel(model, { system: systemPromptFor(agentId), messages: buildMessages(body), signal: ctrl.signal })) {
      send({ t: text });
    }
    send({ done: true, model });
  } catch (err) {
    if (ctrl.signal.aborted || err instanceof Anthropic.APIUserAbortError) return res.end();
    let message = 'Agent crashed. Check the server log.';
    if (err instanceof ProviderError) message = err.message;
    else if (err instanceof Anthropic.AuthenticationError) message = 'Invalid Anthropic API key.';
    else if (err instanceof Anthropic.RateLimitError) message = 'Rate limited. Take a breath and try again.';
    else if (err instanceof Anthropic.APIConnectionError) message = 'Could not reach the Claude API.';
    else if (err instanceof Anthropic.APIError) message = `Claude API error ${err.status ?? ''}`.trim();
    console.error('[tennex] chat error:', err);
    send({ error: message });
  }
  res.end();
}

// Connect/Vite-style middleware: (req, res, next)
export function apiMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/health' && req.method === 'GET') {
    listModels()
      .then((models) => sendJson(res, 200, { live: models.length > 0, models, defaultModel: defaultModel(models) }))
      .catch(() => sendJson(res, 200, { live: false, models: [] }));
    return;
  }
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    handleChat(req, res).catch((err) => {
      console.error('[tennex] unhandled:', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
      else res.end();
    });
    return;
  }
  if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
  next();
}
