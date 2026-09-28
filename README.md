# TENNEX // e/acc office

Home of all things accelerationist and test-maximalist. A Three.js office where five AI agents work at their desks. Walk around, look over their shoulders at their live screens, and talk to them with your voice.

| Agent | Role | Screen |
|---|---|---|
| **Tenx** | Lead Engineer | code editor |
| **Assert** | QA Engineer | test runner |
| **Vector** | Product Lead (and director for roleplay) | plans & briefs |
| **Deploy** | Platform Engineer (CI, deploys, APIs/CLIs) | terminal |
| **Critic** | Principal Reviewer | code review diff |

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Without any model configured the agents run in **sim mode** (canned in-character replies). Press `Esc` in-game to open **Agent brains** and pick a model per agent. Keys stay on the server (`server/providers.js`); copy `.env.example` to `.env` to configure.

### Free, no GPU: Hermes via the Nous Research API

```bash
cp .env.example .env
# edit .env and set NOUS_API_KEY=<your key from the Nous Portal>
npm run dev
```

Press `Esc` → Agent brains; the Hermes models your key can use are listed automatically. If your Nous dashboard shows a different API URL, set `NOUS_BASE_URL`.

Something not showing up? Run `npm run doctor`. It checks each configured provider, prints the exact HTTP responses, and sends a one-word test message. (Opening the API base URL in a browser returns 404; that's normal, because it isn't a web page.)

### Free: Hermes on your own machine (Ollama)

```bash
# 1. install Ollama from https://ollama.com, then pull a Hermes model
ollama pull hermes3          # ~5 GB; smaller/larger tags exist, see ollama.com/library/hermes3
# 2. optional but recommended: give it room for the office context
OLLAMA_CONTEXT_LENGTH=8192 ollama serve
# 3. run the office; Ollama models are auto-detected
npm run dev
```

Then press `Esc` → Agent brains → pick `hermes3` for everyone (or just some agents). Any other model you pull (`ollama pull qwen3`, `llama3.2`, …) shows up too. Models that think in `<think>` tags are handled; the thinking is hidden.

### Other providers

| Provider | Set in `.env` | Notes |
|---|---|---|
| Nous Research | `NOUS_API_KEY` | hosted Hermes, free tier, models auto-listed |
| Claude | `ANTHROPIC_API_KEY` | Opus 5.5, Sonnet 5.5, Haiku 4.5 |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODELS` | hosted Hermes and other open models; some have free variants (check openrouter.ai/models) |
| Any OpenAI-compatible server | `OPENAI_COMPAT_URL`, `OPENAI_COMPAT_MODELS`, `OPENAI_COMPAT_NAME` | LM Studio, vLLM, llama.cpp, or an agent framework that serves `/v1/chat/completions` |

## Controls

| Key | Action |
|---|---|
| Click | enter the office (mouse look) |
| `WASD` / arrows, `Shift` | walk, sprint |
| `V` (hold) | push-to-talk to the agent you're facing (Chrome/Edge) |
| `Enter` | type a prompt instead |
| `F` | zoom into that agent's monitor (again to leave); scroll to read, `C` to open a copyable view |
| `Esc` | pause; pick each agent's model |
| `1`–`5` | walk to an agent's desk |
| `M` | mute agent voices |

Say a name first to reach anyone ("Critic, review Tenx's code"), or "Team, …" to ask everyone. When typing, the agent names are shown as chips; type `@` and press `Tab` to complete one.

## Project brief

Tell the whole team what you're working on. It is sent with every prompt and shown on the wall display:

```
/brief roblox        # cozy Roblox obby with pets, daily reward, leaderboard
/brief cozy          # calm digital chores: notes, website, newsletter
/brief higgsfield    # generative-media promo: script, shots, prompts, API calls
/brief wolf          # comedic trading-floor roleplay, Vector directs
/brief <your own words>
/brief clear
```

Personas and the shared office prompt live in `src/agents/roster.js`. The agents have no tools yet: they write code, commands and plans for you to run, and are told never to fake results.

## Layout

- `src/main.js`: renderer, player movement, focus, talk pipeline
- `src/world/`: office, procedural characters, live monitor canvases, agent state machine
- `src/brain/`: SAY/SCREEN stream parser, name router, API client, offline simulator
- `src/agents/roster.js`: the crew (looks, voices, personas)
- `server/`: Claude streaming proxy (Vite middleware in dev, `npm start` in prod)
- `tests/`: `npm test` (tests are acceleration)
