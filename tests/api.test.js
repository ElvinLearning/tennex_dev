import { describe, it, expect } from 'vitest';
import { buildMessages } from '../server/api.js';
import { systemPromptFor, AGENTS } from '../src/agents/roster.js';

describe('buildMessages', () => {
  it('ends with the new prompt and includes the office feed', () => {
    const m = buildMessages({ prompt: 'ship it', office: ['Deploy: ✓ deploy #1'] });
    expect(m).toHaveLength(1);
    expect(m[0].role).toBe('user');
    expect(m[0].content).toContain('Deploy: ✓ deploy #1');
    expect(m[0].content).toContain('Human says: ship it');
  });

  it('keeps roles alternating and starting with user', () => {
    const history = [
      { role: 'assistant', content: 'stray' },
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'c' },
      { role: 'system', content: 'ignore me' },
      { role: 'user', content: 'd' },
    ];
    const m = buildMessages({ history, prompt: 'e' });
    expect(m[0].role).toBe('user');
    for (let i = 1; i < m.length; i++) expect(m[i].role).not.toBe(m[i - 1].role);
    expect(m.at(-1).content).toContain('Human says: e');
    expect(JSON.stringify(m)).not.toContain('ignore me');
  });

  it('clips oversized input', () => {
    const m = buildMessages({ prompt: 'x'.repeat(10_000) });
    expect(m[0].content.length).toBeLessThan(2_100);
  });
});

describe('system prompts', () => {
  it('exist for every agent and describe the reply format', () => {
    for (const a of AGENTS) {
      const s = systemPromptFor(a.id);
      expect(s).toContain('SAY:');
      expect(s).toContain('SCREEN:');
      expect(s).toContain(a.name);
    }
    expect(() => systemPromptFor('nope')).toThrow();
  });
});
