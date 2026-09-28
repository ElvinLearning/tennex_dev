// Offline "sim mode": no API key needed. Produces in-character replies in the
// same SAY/SCREEN format as the live agents so the whole office still works.

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

export function topicOf(prompt) {
  const stop = new Set(
    'a an the to for of and or with me my your you please can could would build make write create add some it this that on in is be ship test deploy hey tenx assert vector critic what should we us our how why do does get need lets let today now'.split(
      ' ',
    ),
  );
  const words = String(prompt)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !stop.has(w));
  return words.slice(0, 3).join('-') || 'thing';
}

const camel = (slug) => slug.replace(/-(\w)/g, (_, c) => c.toUpperCase());

const SIM = {
  tenx(prompt, topic) {
    const fn = camel(topic);
    return {
      say: pick([
        `First pass of ${topic.replace(/-/g, ' ')} is on my screen. Assert, can you add tests?`,
        `Kept it small: one module with input validation. Next I'd wire it into the app.`,
        `Here's a working starting point. Tell me what to change and I'll iterate.`,
      ]),
      screen: `// src/${topic}.ts  (sim mode: add an API key for real code)
import { z } from "zod";

export const ${fn}Input = z.object({
  id: z.string().uuid(),
  payload: z.record(z.unknown()),
});

export async function ${fn}(raw: unknown) {
  const input = ${fn}Input.parse(raw);
  const started = performance.now();
  const result = await accelerate(input.payload);
  return { id: input.id, result, ms: performance.now() - started };
}

async function accelerate<T>(x: T): Promise<T> {
  // Placeholder: sim mode. Add an API key and I'll write the real implementation.
  return x;
}

// next: tests (Assert), review (Critic)`,
    };
  },
  assert(prompt, topic) {
    const fn = camel(topic);
    const n = 6 + Math.floor(Math.random() * 6);
    const cases = ['parses valid input', 'rejects bad uuid', 'handles empty payload', 'is idempotent', 'survives 10k calls', 'never returns undefined', 'respects timeouts', 'handles unicode 🚀'];
    return {
      say: pick([
        `I wrote a test file for ${topic.replace(/-/g, ' ')}. Run the command on screen to check it.`,
        `Tests cover the happy path and bad input. I'd add a load test next.`,
      ]),
      screen: `// tests/${topic}.test.ts
import { describe, it, expect } from "vitest";
import { ${fn} } from "../src/${topic}";

describe("${fn}", () => {
  it("${cases[0]}", async () => {
    await expect(${fn}(valid())).resolves.toBeDefined();
  });
  it("${cases[1]}", async () => {
    await expect(${fn}({ id: "nope" })).rejects.toThrow();
  });
});

$ vitest run tests/${topic}.test.ts
${cases
  .slice(0, n > cases.length ? cases.length : n)
  .map((c) => ` ✓ ${fn} > ${c}  ${1 + Math.floor(Math.random() * 9)}ms`)
  .join('\n')}

 Test Files  1 passed (1)
      Tests  ${Math.min(n, cases.length)} passed (${Math.min(n, cases.length)})
   Duration  ${(0.2 + Math.random()).toFixed(2)}s   (sim mode)`,
    };
  },
  vector(prompt, topic) {
    return {
      say: pick([
        `Here's a plan for ${topic.replace(/-/g, ' ')}: small first version, then iterate with real feedback.`,
        `Roadmap's on my screen. Tenx should start on the first milestone today.`,
      ]),
      screen: `PLAN :: ${topic.toUpperCase()}

  NOW   ▸ ship v0 of ${topic} behind a flag      owner: Tenx
        ▸ tests on every path                    owner: Assert
  NEXT  ▸ canary to 5% → 50% → 100%              owner: Deploy
        ▸ review for sharp edges                 owner: Critic
  LATER ▸ make it self-improving                 owner: everyone

  KPIs
    first playable   ██████░░░░░░  in progress
    test coverage    ████████░░░░  target 80%

  NEXT ACTION: Tenx builds the v0 of ${topic.replace(/-/g, ' ')} (sim mode)`,
    };
  },
  deploy(prompt, topic) {
    const sha = Math.random().toString(16).slice(2, 9);
    return {
      say: pick([
        `Here's the deploy pipeline and the commands, with a rollback step at the end.`,
        `I've written the release steps. Run them in order and check the health endpoint after.`,
      ]),
      screen: `$ git push origin main
   ${sha}  feat: ${topic}
$ gh workflow run ship.yml
✓ lint           4s
✓ test          21s
✓ build         38s
✓ image         ghcr.io/tennex/${topic}:${sha}
$ kubectl rollout status deploy/${topic}
  canary   5%  p99 41ms  errors 0.00%  ✓
  canary  50%  p99 43ms  errors 0.00%  ✓
  rollout 100%                          ✓
deployment "${topic}" successfully rolled out
$ echo "rollback: kubectl rollout undo deploy/${topic}"   # sim mode`,
    };
  },
  critic(prompt, topic) {
    const fn = camel(topic);
    return {
      say: pick([
        `Mostly solid. One blocking issue: unvalidated input. The fix is on my screen.`,
        `Looks good with one change: don't swallow errors. Details on screen.`,
      ]),
      screen: `src/${topic}.ts
@@ -12,7 +12,9 @@ export async function ${fn}(raw) {
-  const input = raw as Input;
+  const input = ${fn}Input.parse(raw);
+  if (!input.payload) return { id: input.id, result: null };
   const result = await accelerate(input.payload);

 💬 Critic: never cast untrusted input; parse it. Blocking.

@@ -30,3 +32,3 @@
-  catch (e) {}
+  catch (e) { log.error(e); throw e; }

 💬 Critic: swallowed errors hide failures. Log and rethrow.

 ✅ Approve once these are fixed.   (sim mode)`,
    };
  },
};

export async function* simulateReply({ agentId, prompt, signal }) {
  const topic = topicOf(prompt);
  const { say, screen } = (SIM[agentId] ?? SIM.tenx)(prompt, topic);
  const text = `SAY: ${say}\nSCREEN:\n${screen}\n`;
  await sleep(500 + Math.random() * 600, signal); // "thinking"
  for (let i = 0; i < text.length; ) {
    const n = 2 + Math.floor(Math.random() * 6);
    yield text.slice(i, i + n);
    i += n;
    await sleep(12, signal);
  }
}
