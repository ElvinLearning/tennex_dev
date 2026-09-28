import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { ThinkFilter, listModels, streamModel } from '../server/providers.js';

describe('ThinkFilter', () => {
  const run = (chunks) => {
    const f = new ThinkFilter();
    return chunks.map((c) => f.push(c)).join('') + f.end();
  };

  it('strips <think> blocks, even when tags are split across chunks', () => {
    const text = '<think>plan it</think>SAY: Hi.\nSCREEN:\nx < y';
    for (let size = 1; size <= 9; size++) {
      const chunks = [];
      for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
      expect(run(chunks), `size ${size}`).toBe('SAY: Hi.\nSCREEN:\nx < y');
    }
  });

  it('passes through text with no think tags', () => {
    expect(run(['a <b> c', ' <thin', 'g>'])).toBe('a <b> c <thing>');
  });
});

describe('OpenAI-compatible provider (fake Ollama)', () => {
  let server;
  let lastBody;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ models: [{ name: 'hermes3:8b' }] }));
      }
      if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          lastBody = JSON.parse(body);
          if (lastBody.model === 'broken') {
            res.writeHead(404);
            return res.end('model not found');
          }
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          for (const t of ['<think>hmm</think>', 'SAY: Hello', ' there.\nSCREEN:\n', 'print(1)']) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
          }
          res.end('data: [DONE]\n\n');
        });
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise((r) => server.listen(0, r));
    process.env.OLLAMA_URL = `http://127.0.0.1:${server.address().port}`;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });
  afterAll(() => server.close());

  it('lists installed Ollama models', async () => {
    const models = await listModels();
    expect(models).toContainEqual({ id: 'ollama:hermes3:8b', label: 'hermes3:8b', provider: 'Ollama (local)' });
    expect(models.some((m) => m.id.startsWith('claude:'))).toBe(false);
  });

  it('streams a reply with the system prompt first and thinking removed', async () => {
    let out = '';
    for await (const t of streamModel('ollama:hermes3:8b', { system: 'SYS', messages: [{ role: 'user', content: 'hi' }] })) out += t;
    expect(out).toBe('SAY: Hello there.\nSCREEN:\nprint(1)');
    expect(lastBody.model).toBe('hermes3:8b');
    expect(lastBody.stream).toBe(true);
    expect(lastBody.messages[0]).toEqual({ role: 'system', content: 'SYS' });
  });

  it('turns HTTP errors into readable messages', async () => {
    const gen = streamModel('ollama:broken', { system: 'S', messages: [] });
    await expect(gen.next()).rejects.toThrow(/Ollama \(local\) returned 404: model not found/);
  });
});
