import { describe, it, expect } from 'vitest';
import { ReplyParser } from '../src/brain/parser.js';

function run(chunks) {
  const out = { say: '', screen: '', sentences: [] };
  const p = new ReplyParser({
    onSay: (d) => (out.say += d),
    onScreen: (d) => (out.screen += d),
    onSentence: (s) => out.sentences.push(s),
  });
  chunks.forEach((c) => p.push(c));
  return { ...out, final: p.end() };
}

const REPLY = 'SAY: Shipping it now. Tests are green!\nSCREEN:\nconst x = 1;\n+ added line\n';

describe('ReplyParser', () => {
  it('splits SAY and SCREEN in one chunk', () => {
    const r = run([REPLY]);
    expect(r.final.say).toBe('Shipping it now. Tests are green!');
    expect(r.final.screen).toBe('const x = 1;\n+ added line');
    expect(r.sentences).toEqual(['Shipping it now.', 'Tests are green!']);
  });

  it('gives the same result for every possible chunking', () => {
    for (let size = 1; size <= 12; size++) {
      const chunks = [];
      for (let i = 0; i < REPLY.length; i += size) chunks.push(REPLY.slice(i, i + size));
      const r = run(chunks);
      expect(r.final.say, `chunk size ${size}`).toBe('Shipping it now. Tests are green!');
      expect(r.final.screen, `chunk size ${size}`).toBe('const x = 1;\n+ added line');
      expect(r.say.trim()).toBe(r.final.say);
      expect(r.say).not.toMatch(/SCREEN|SAY:/);
    }
  });

  it('never leaks a partial SCREEN marker into speech', () => {
    const r = run(['SAY: Hi.\nSCR', 'EEN:\ncode']);
    expect(r.say).toBe('Hi.\n');
    expect(r.screen).toBe('code');
  });

  it('treats a reply without a SCREEN section as pure speech', () => {
    const r = run(['SAY: Just chatting. ', 'Nothing to show.']);
    expect(r.final).toEqual({ say: 'Just chatting. Nothing to show.', screen: '' });
    expect(r.sentences).toEqual(['Just chatting.', 'Nothing to show.']);
  });

  it('tolerates a missing SAY prefix', () => {
    const r = run(['Sure thing.\nSCREEN:\nls -la']);
    expect(r.final).toEqual({ say: 'Sure thing.', screen: 'ls -la' });
  });

  it('ignores "SCREEN:" that is not at the start of a line', () => {
    const r = run(['SAY: my SCREEN: is huge.\nSCREEN:\nok']);
    expect(r.final.say).toBe('my SCREEN: is huge.');
    expect(r.final.screen).toBe('ok');
  });
});
