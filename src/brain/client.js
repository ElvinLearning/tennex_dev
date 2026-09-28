// Talks to /api/chat (Claude, live) or falls back to the local simulator.

import { simulateReply } from './sim.js';

export async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return { live: false };
    return await res.json();
  } catch {
    return { live: false };
  }
}

// Yields text chunks of the agent's raw reply.
export async function* streamReply({ live, agentId, history, prompt, office, brief, signal }) {
  if (!live) {
    yield* simulateReply({ agentId, prompt, signal });
    return;
  }
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId, history, prompt, office, brief }),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let sep;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const evt = JSON.parse(line.slice(6));
      if (evt.error) throw new Error(evt.error);
      if (evt.t) yield evt.t;
    }
  }
}
