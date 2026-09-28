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

Without an API key the agents run in **sim mode** (canned in-character replies). To make them real, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. The key stays on the server (`server/api.js` streams from Claude).

## Controls

| Key | Action |
|---|---|
| Click | enter the office (mouse look) |
| `WASD` / arrows, `Shift` | walk, sprint |
| `V` (hold) | push-to-talk to the agent you're facing (Chrome/Edge) |
| `Enter` | type a prompt instead |
| `F` | zoom into that agent's monitor (again to leave); scroll to read, `C` to copy |
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
