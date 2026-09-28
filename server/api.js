// Tiny API for the office. Framework-free so it can run as Vite dev middleware
// and inside the plain Node production server.
//
//   GET  /api/health  -> { live: boolean, model }
//   POST /api/chat    -> text/event-stream of { t } text deltas, then { done } or { error }

import Anthropic from '@anthropic-ai/sdk';
import { AGENT_BY_ID, systemPromptFor } from '../src/agents/roster.js';

try {
  process.loadEnvFile?.('.env');
} catch {
  // no .env file: fine, fall back to the real environment
}

const MODEL = process.env.TENNEX_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.TENNEX_EFFORT || 'low'; // snappy replies for a spoken conversation
const MAX_BODY = 200_000;
const MAX_HISTORY = 24;
const MAX_TEXT = 8_000;

const hasCredentials = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client;
const getClient = () => (client ??= new Anthropic());

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
export function buildMessages({ history = [], prompt, office = [] }) {
  const messages = [];
  for (const m of history.slice(-MAX_HISTORY)) {
    if ((m?.role !== 'user' && m?.role !== 'assistant') || !m.content) continue;
    const last = messages[messages.length - 1];
    if (last?.role === m.role) last.content += `\n\n${clip(m.content)}`;
    else messages.push({ role: m.role, content: clip(m.content) });
  }
  while (messages[0]?.role === 'assistant') messages.shift();

  const feed = office.slice(-12).map((l) => `- ${clip(l, 300)}`).join('\n');
  const content = (feed ? `[Office feed, most recent last]\n${feed}\n\n` : '') + `Human says: ${clip(prompt, 2000)}`;
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
  if (!hasCredentials()) return sendJson(res, 503, { error: 'No ANTHROPIC_API_KEY configured; running in sim mode' });

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
    // If a safety classifier declines, let the API re-route to its recommended fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    cache_control: { type: 'ephemeral' },
    system: systemPromptFor(agentId),
    messages: buildMessages(body),
  });
  // Stop paying for tokens nobody will see if the player walks away.
  res.on('close', () => stream.abort());

  try {
    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'thinking') send({ thinking: true });
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') send({ t: event.delta.text });
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') send({ error: 'The agent declined that request.' });
    else send({ done: true, stop: final.stop_reason, model: final.model });
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) return;
    let message = 'Agent crashed. Check the server log.';
    if (err instanceof Anthropic.AuthenticationError) message = 'Invalid Anthropic API key.';
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
    return sendJson(res, 200, { live: hasCredentials(), model: MODEL });
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
