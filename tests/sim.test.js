import { describe, it, expect } from 'vitest';
import { simulateReply, topicOf } from '../src/brain/sim.js';
import { ReplyParser } from '../src/brain/parser.js';
import { AGENTS } from '../src/agents/roster.js';

describe('sim mode', () => {
  it('extracts a topic slug from a prompt', () => {
    expect(topicOf('Hey Tenx, build me a rate limiter please')).toBe('rate-limiter');
    expect(topicOf('???')).toBe('thing');
  });

  for (const agent of AGENTS) {
    it(`${agent.name} replies in SAY/SCREEN format`, async () => {
      const p = new ReplyParser();
      for await (const chunk of simulateReply({ agentId: agent.id, prompt: 'build a rate limiter' })) p.push(chunk);
      const { say, screen } = p.end();
      expect(say.length).toBeGreaterThan(5);
      expect(screen.split('\n').length).toBeGreaterThan(5);
    });
  }
});
