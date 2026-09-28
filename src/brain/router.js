// Decides who a spoken/typed prompt is for.
//   "Critic, review this"   -> critic
//   "@deploy ship it"       -> deploy
//   "hey 10x build a CLI"   -> tenx (speech recognition hears "10x")
//   "team, what's next?"    -> everyone
//   anything else           -> the agent you're standing next to

const ALIASES = {
  tenx: ['tenx', '10x', 'ten x', '10 x', 'tenex', 'ten ex'],
  assert: ['assert', 'asserts'],
  vector: ['vector', 'victor'],
  deploy: ['deploy'],
  critic: ['critic', 'critique', 'kritik'],
};
// Names that are also verbs ("deploy it", "assert that...") only count as an
// address with "@", a greeting ("hey deploy ..."), or punctuation ("Deploy, ...").
const VERBS = new Set(['deploy', 'assert']);
const EVERYONE = ['team', 'everyone', 'everybody', 'all agents', 'all hands', "y'all", 'yall'];
const GREETING = /^(?:hey|hi|yo|ok|okay|hello|so)[\s,]+/i;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function stripAddress(text, words, strict = false) {
  for (const w of words) {
    const re = strict
      ? new RegExp(`^(?:@${escape(w)}(?![\\w-])[\\s,:.!-]*|${escape(w)}\\s*[,:!-]\\s*)`, 'i')
      : new RegExp(`^@?${escape(w)}(?![\\w-])[\\s,:.!-]*`, 'i');
    if (re.test(text)) return text.replace(re, '').trim();
  }
  return null;
}

export function routePrompt(text, agentIds, focusedId = null) {
  const original = String(text ?? '').trim();
  if (!original) return { targets: [], text: '' };
  const body = original.replace(GREETING, '');
  const greeted = body !== original || body.startsWith('@');

  const all = stripAddress(body, EVERYONE);
  if (all !== null && all) return { targets: [...agentIds], text: all };

  for (const id of agentIds) {
    const rest = stripAddress(body, ALIASES[id] ?? [id], VERBS.has(id) && !greeted);
    if (rest !== null && rest) return { targets: [id], text: rest };
  }
  return { targets: focusedId ? [focusedId] : [], text: original };
}
