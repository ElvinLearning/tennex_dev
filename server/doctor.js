// npm run doctor: check every configured model provider from your machine.
// Lists the models each one offers and sends one tiny test message.

import { listModels, streamModel } from './providers.js';

try {
  process.loadEnvFile?.('.env');
} catch {
  console.log('(no .env file found; using the current environment)');
}

const mask = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)} (${k.length} chars)` : 'not set');
console.log('\nConfigured:');
console.log(`  NOUS_API_KEY        ${mask(process.env.NOUS_API_KEY)}`);
console.log(`  NOUS_BASE_URL       ${process.env.NOUS_BASE_URL || 'https://inference-api.nousresearch.com/v1 (default)'}`);
console.log(`  ANTHROPIC_API_KEY   ${mask(process.env.ANTHROPIC_API_KEY)}`);
console.log(`  OPENROUTER_API_KEY  ${mask(process.env.OPENROUTER_API_KEY)}`);
console.log(`  OLLAMA_URL          ${process.env.OLLAMA_URL || 'http://localhost:11434 (default)'}`);

if (process.env.NOUS_API_KEY) {
  const base = (process.env.NOUS_BASE_URL || 'https://inference-api.nousresearch.com/v1').replace(/\/$/, '');
  console.log(`\nNous: GET ${base}/models`);
  try {
    const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${process.env.NOUS_API_KEY}` } });
    const body = await res.text();
    console.log(`  HTTP ${res.status}: ${body.slice(0, 400)}`);
    if (res.status === 401) console.log('  → the key was rejected. Copy it again from the Nous Portal.');
    if (res.status === 403) console.log('  → access refused: check the key, and that your plan includes API access.');
    if (res.status === 404) console.log('  → no /models list here. Set NOUS_MODELS=<model name from the docs> in .env instead.');
  } catch (err) {
    console.log(`  could not connect: ${err.cause?.code ?? err.message}`);
  }
}

const models = await listModels();
console.log(`\nModels the office will offer (${models.length}):`);
for (const m of models) console.log(`  ${m.id}`);
if (!models.length) console.log('  none: only the offline sim will be available.');

for (const provider of [...new Set(models.map((m) => m.id.split(':')[0]))]) {
  const model = models.find((m) => m.id.startsWith(`${provider}:`));
  process.stdout.write(`\nTest message to ${model.id} … `);
  try {
    let out = '';
    for await (const t of streamModel(model.id, {
      system: 'Reply with exactly: OK',
      messages: [{ role: 'user', content: 'ping' }],
    })) {
      out += t;
      if (out.length > 200) break;
    }
    console.log(`reply: ${JSON.stringify(out.trim().slice(0, 80))}`);
  } catch (err) {
    console.log(`failed: ${err.message}`);
  }
}
console.log('');
