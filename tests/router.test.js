import { describe, it, expect } from 'vitest';
import { routePrompt } from '../src/brain/router.js';

const IDS = ['tenx', 'assert', 'vector', 'deploy', 'critic'];

describe('routePrompt', () => {
  it('defaults to the focused agent', () => {
    expect(routePrompt('build a todo app', IDS, 'tenx')).toEqual({ targets: ['tenx'], text: 'build a todo app' });
  });

  it('returns no target when nobody is focused or named', () => {
    expect(routePrompt('build a todo app', IDS, null).targets).toEqual([]);
  });

  it('routes by name with comma, @ or greeting', () => {
    expect(routePrompt('Critic, review this', IDS, 'tenx')).toEqual({ targets: ['critic'], text: 'review this' });
    expect(routePrompt('@deploy ship it', IDS)).toEqual({ targets: ['deploy'], text: 'ship it' });
    expect(routePrompt('hey vector what next', IDS)).toEqual({ targets: ['vector'], text: 'what next' });
  });

  it('understands speech-recognition spellings of Tenx', () => {
    expect(routePrompt('hey 10x build a CLI', IDS).targets).toEqual(['tenx']);
    expect(routePrompt('ten x make it faster', IDS).targets).toEqual(['tenx']);
  });

  it('does not treat verb-names as addresses without a cue', () => {
    expect(routePrompt('deploy it to staging', IDS, 'tenx')).toEqual({ targets: ['tenx'], text: 'deploy it to staging' });
    expect(routePrompt('assert that x is 1', IDS, 'critic').targets).toEqual(['critic']);
    expect(routePrompt('hey deploy roll back', IDS, 'tenx')).toEqual({ targets: ['deploy'], text: 'roll back' });
  });

  it('broadcasts to the team', () => {
    expect(routePrompt('Team, what should we ship today?', IDS)).toEqual({ targets: IDS, text: 'what should we ship today?' });
  });

  it('does not match names inside other words', () => {
    expect(routePrompt('vectorize this loop', IDS, 'tenx').targets).toEqual(['tenx']);
  });
});
