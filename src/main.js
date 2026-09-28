import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { AGENTS } from './agents/roster.js';
import { buildOffice, ROOM } from './world/office.js';
import { AgentActor } from './world/agent-actor.js';
import { ReplyParser } from './brain/parser.js';
import { checkHealth, streamReply } from './brain/client.js';
import { routePrompt } from './brain/router.js';
import { PushToTalk, Speaker, voiceSupport } from './voice.js';

const $ = (id) => document.getElementById(id);
const EYE = 1.65;
const PLAYER_R = 0.3;
const FOCUS_DIST = 3.2;

// ---------------------------------------------------------------- renderer
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#07060d');
scene.fog = new THREE.Fog('#07060d', 18, 40);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 100);
camera.position.set(2, EYE, 5.5);
camera.lookAt(0, 1.4, -9);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- world
const office = buildOffice(scene);
const agents = AGENTS.map((def, i) => new AgentActor(def, office.desks[i], i, scene));
const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

const state = {
  live: false,
  model: '',
  focused: null,
  screenView: null, // { agent, from: {pos, quat}, t, back }
  typing: false,
  stats: { prompts: 0, lines: 0, tests: 0, agents: agents.length, live: false, model: '' },
  feed: [
    'Tenx pushed 3 commits to main',
    'Assert: 412 tests green',
    'Deploy shipped v0.0.1 to prod',
    'Critic approved PR #1336',
    'Vector: velocity is compounding',
  ],
};

const speaker = new Speaker();

function feed(line) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  state.feed.push(`${time} ${line}`);
  if (state.feed.length > 60) state.feed.shift();
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 5000);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}

// ---------------------------------------------------------------- controls
const controls = new PointerLockControls(camera, document.body);
const keys = new Set();
const velocity = new THREE.Vector3();
let bobT = 0;

function setPaused(p) {
  document.body.classList.toggle('paused', p);
}
setPaused(true);

$('enter').addEventListener('click', () => {
  controls.lock();
  if (voiceSupport.speak) speechSynthesis.getVoices(); // warm up voices on a user gesture
});
controls.addEventListener('lock', () => setPaused(false));
controls.addEventListener('unlock', () => {
  if (state.screenView && !state.typing) exitScreenView();
  if (!state.typing) setPaused(true);
});

addEventListener('keydown', (e) => {
  if (state.typing) return;
  const active = controls.isLocked || state.screenView;
  if (!active) return;
  keys.add(e.code);
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyT':
      startListening();
      break;
    case 'Enter':
      e.preventDefault();
      openInput();
      break;
    case 'KeyF':
      if (state.screenView) exitScreenView();
      else if (state.focused) enterScreenView(state.focused);
      break;
    case 'Escape':
      if (state.screenView) exitScreenView();
      break;
    case 'KeyM':
      $('mute-state').textContent = speaker.toggleMute() ? 'voice off' : 'voice on';
      break;
    case 'Digit1':
    case 'Digit2':
    case 'Digit3':
    case 'Digit4':
    case 'Digit5':
      goToAgent(agents[Number(e.code.slice(5)) - 1]);
      break;
  }
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'KeyT') stopListening();
});
addEventListener('blur', () => {
  keys.clear();
  stopListening();
});

function collide(pos) {
  for (const c of office.colliders) {
    const nx = THREE.MathUtils.clamp(pos.x, c.minX, c.maxX);
    const nz = THREE.MathUtils.clamp(pos.z, c.minZ, c.maxZ);
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < PLAYER_R * PLAYER_R) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * PLAYER_R;
        pos.z = nz + (dz / d) * PLAYER_R;
      } else {
        // center is inside the box: push out along the shallowest axis
        const pushes = [
          [c.minX - PLAYER_R - pos.x, 0],
          [c.maxX + PLAYER_R - pos.x, 0],
          [0, c.minZ - PLAYER_R - pos.z],
          [0, c.maxZ + PLAYER_R - pos.z],
        ].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        pos.x += pushes[0][0];
        pos.z += pushes[0][1];
      }
    }
  }
  for (const a of agents) {
    const dx = pos.x - a.position.x;
    const dz = pos.z - a.position.z;
    const d = Math.hypot(dx, dz);
    const min = PLAYER_R + 0.32;
    if (d < min && d > 1e-6) {
      pos.x = a.position.x + (dx / d) * min;
      pos.z = a.position.z + (dz / d) * min;
    }
  }
  pos.x = THREE.MathUtils.clamp(pos.x, -ROOM.w / 2 + PLAYER_R, ROOM.w / 2 - PLAYER_R);
  pos.z = THREE.MathUtils.clamp(pos.z, -ROOM.d / 2 + PLAYER_R, ROOM.d / 2 - PLAYER_R);
}

let autoWalk = null; // { from, to, look, t, dur }

function goToAgent(agent) {
  if (!agent) return;
  if (state.screenView) exitScreenView(true);
  const spot = agent.atDesk ? agent.desk.viewSpot() : agent.position.clone().add(new THREE.Vector3(0, 0, 1.4));
  const look = agent.atDesk ? agent.desk.screenCenter() : agent.position.clone().setY(1.5);
  const from = camera.position.clone();
  const to = spot.setY(EYE);
  autoWalk = { from, to, fromQ: camera.quaternion.clone(), toQ: lookQuat(to, look), t: 0, dur: THREE.MathUtils.clamp(from.distanceTo(to) / 9, 0.35, 1.6) };
  agent.summon();
}

function lookQuat(from, target) {
  const m = new THREE.Matrix4().lookAt(from, target, new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function movePlayer(dt) {
  if (autoWalk) {
    autoWalk.t += dt / autoWalk.dur;
    const k = easeInOut(Math.min(1, autoWalk.t));
    camera.position.lerpVectors(autoWalk.from, autoWalk.to, k);
    camera.quaternion.slerpQuaternions(autoWalk.fromQ, autoWalk.toQ, k);
    if (autoWalk.t >= 1) autoWalk = null;
    return;
  }
  if (!controls.isLocked || state.screenView) return;
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 7 : 3.6;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const want = forward.multiplyScalar(f).add(right.multiplyScalar(r));
  if (want.lengthSq() > 0) want.normalize().multiplyScalar(speed);
  velocity.lerp(want, Math.min(1, dt * 10));
  const pos = camera.position;
  pos.addScaledVector(velocity, dt);
  collide(pos);
  const moving = velocity.length() > 0.3;
  bobT += moving ? dt * velocity.length() * 2.2 : 0;
  pos.y = EYE + (moving ? Math.sin(bobT) * 0.035 : 0);
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ---------------------------------------------------------------- screen view
function enterScreenView(agent) {
  const center = agent.desk.screenCenter();
  const normal = agent.desk.screenNormal();
  // Between the agent's head and the monitor, so the screen fills the view.
  const to = center.clone().addScaledVector(normal, 0.7);
  state.screenView = { agent, from: { pos: camera.position.clone(), quat: camera.quaternion.clone() }, to, toQ: lookQuat(to, center), t: 0, back: false };
  controls.enabled = false;
  bloom.enabled = false;
  document.body.classList.add('screen-view');
  agent.summon();
  updateHint();
}

function exitScreenView(instant = false) {
  const sv = state.screenView;
  if (!sv) return;
  if (instant) {
    camera.position.copy(sv.from.pos);
    camera.quaternion.copy(sv.from.quat);
    finishExit();
  } else {
    sv.back = true;
    sv.t = 0;
  }
}

function finishExit() {
  state.screenView = null;
  controls.enabled = true;
  bloom.enabled = true;
  document.body.classList.remove('screen-view');
  updateHint();
  if (!controls.isLocked && !state.typing) setPaused(true);
}

function updateScreenView(dt) {
  const sv = state.screenView;
  if (!sv) return;
  sv.t = Math.min(1, sv.t + dt / 0.55);
  const k = easeInOut(sv.t);
  if (!sv.back) {
    camera.position.lerpVectors(sv.from.pos, sv.to, k);
    camera.quaternion.slerpQuaternions(sv.from.quat, sv.toQ, k);
  } else {
    camera.position.lerpVectors(sv.to, sv.from.pos, k);
    camera.quaternion.slerpQuaternions(sv.toQ, sv.from.quat, k);
    if (sv.t >= 1) finishExit();
  }
}

// ---------------------------------------------------------------- focus
function computeFocus() {
  if (state.screenView) return state.screenView.agent;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  let best = null;
  let bestScore = Infinity;
  for (const a of agents) {
    const to = a.position.clone().setY(1.2).sub(camera.position);
    const dist = to.length();
    if (dist > FOCUS_DIST) continue;
    const angle = fwd.angleTo(to.normalize());
    if (angle > 1.0) continue;
    const score = dist + angle * 2;
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  // Standing behind an agent looking at their monitor also counts.
  if (!best) {
    for (const a of agents) {
      const c = a.desk.screenCenter();
      const to = c.clone().sub(camera.position);
      if (to.length() < 3.4 && fwd.angleTo(to.normalize()) < 0.5) return a;
    }
  }
  return best;
}

// ---------------------------------------------------------------- HUD
const rosterEls = {};
for (const a of agents) {
  const el = document.createElement('div');
  el.className = 'agent';
  el.style.color = a.def.color;
  el.innerHTML = `<span class="dot"></span><b></b><span class="num">[${a.index + 1}]</span><span class="status"></span>`;
  el.querySelector('b').textContent = a.def.name;
  el.querySelector('b').style.color = '#fff';
  $('roster').appendChild(el);
  rosterEls[a.id] = el;
}

let lastHintKey = '';
function updateHint() {
  const a = state.focused;
  const key = `${a?.id}|${!!state.screenView}|${state.typing}`;
  if (key === lastHintKey) return;
  lastHintKey = key;
  const hint = $('hint');
  if (state.typing || !a) {
    hint.classList.add('hidden');
    if (!state.typing) renderPanel(lastPanelAgent);
    return;
  }
  hint.classList.remove('hidden');
  hint.style.setProperty('--hint-color', a.def.color);
  const talk = voiceSupport.listen ? '<kbd>T</kbd> hold to talk · ' : '';
  hint.innerHTML = state.screenView
    ? `Watching <b></b>'s screen · ${talk}<kbd>Enter</kbd> type · <kbd>F</kbd> leave`
    : `<b></b> <span style="color:#a1a1aa">${a.def.title}</span> · ${talk}<kbd>Enter</kbd> type · <kbd>F</kbd> watch screen`;
  hint.querySelector('b').textContent = a.def.name;
  renderPanel(a);
}

let lastPanelAgent = null;
function renderPanel(agent) {
  const panel = $('panel');
  if (!agent || !agent.transcript.length) {
    panel.classList.add('hidden');
    lastPanelAgent = agent ?? lastPanelAgent;
    return;
  }
  lastPanelAgent = agent;
  panel.classList.remove('hidden');
  panel.style.setProperty('--agent', agent.def.color);
  panel.querySelector('.dot').style.color = agent.def.color;
  $('panel-name').textContent = agent.def.name;
  $('panel-title').textContent = agent.def.title;
  const log = $('panel-log');
  log.replaceChildren(
    ...agent.transcript.slice(-8).map((m) => {
      const el = document.createElement('div');
      el.className = `msg ${m.who}`;
      el.textContent = m.text || '…';
      return el;
    }),
  );
}

function refreshRoster() {
  for (const a of agents) {
    const el = rosterEls[a.id];
    el.classList.toggle('focused', state.focused === a);
    const label = { autopilot: 'autopilot', break: 'on a break', listening: 'listening', thinking: 'thinking', typing: 'shipping', talking: 'talking', error: 'crashed' }[a.status];
    const s = el.querySelector('.status');
    if (s.textContent !== label) s.textContent = label;
  }
}

// ---------------------------------------------------------------- talking
const ptt = new PushToTalk({
  onInterim: (t) => {
    $('caption').textContent = t || 'listening…';
  },
  onFinal: (t) => {
    $('caption').classList.add('hidden');
    submitPrompt(t);
  },
  onError: (err) => {
    $('caption').classList.add('hidden');
    toast(err === 'not-allowed' ? 'Microphone blocked. Allow mic access, or press Enter to type.' : `Speech error: ${err}`);
  },
  onState: (on) => {
    if (!on) {
      agents.forEach((a) => (a.listening = false));
      setTimeout(() => !ptt.active && $('caption').classList.add('hidden'), 300);
    }
  },
});

function startListening() {
  if (!voiceSupport.listen) {
    toast('Speech recognition is not supported in this browser (try Chrome or Edge). Press Enter to type.');
    return;
  }
  speaker.cancel(); // barge-in: talking over an agent shuts them up
  if (ptt.start()) {
    $('caption').textContent = 'listening…';
    $('caption').classList.remove('hidden');
    if (state.focused) state.focused.listening = true;
  }
}

function stopListening() {
  ptt.stop();
}

function openInput() {
  state.typing = true;
  document.body.classList.add('typing');
  const target = state.focused;
  $('input-target').textContent = target ? `→ ${target.def.name}` : '→ @name';
  $('input-target').style.color = target?.def.color ?? '#a1a1aa';
  $('inputbar').classList.remove('hidden');
  keys.clear();
  if (controls.isLocked) controls.unlock();
  setTimeout(() => $('input').focus(), 0);
  updateHint();
}

function closeInput() {
  state.typing = false;
  document.body.classList.remove('typing');
  $('inputbar').classList.add('hidden');
  $('input').value = '';
  $('input').blur();
  lastHintKey = '';
  if (!state.screenView) {
    controls.lock();
    // Browsers may refuse to re-lock without a click; show the resume screen if so.
    setTimeout(() => !controls.isLocked && !state.screenView && setPaused(true), 250);
  }
}

$('inputbar').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('input').value.trim();
  closeInput();
  if (text) submitPrompt(text);
});
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeInput();
});

function submitPrompt(raw) {
  const { targets, text } = routePrompt(raw, agents.map((a) => a.id), state.focused?.id);
  if (!targets.length) {
    toast(`Nobody heard "${raw}". Walk up to an agent, or start with their name.`);
    return;
  }
  for (const id of targets) ask(byId[id], text);
}

async function ask(agent, prompt) {
  agent.abort?.abort();
  const ctrl = new AbortController();
  agent.abort = ctrl;
  agent.busy = true;
  agent.error = false;
  agent.summon();
  agent.lastPromptAt = timer.getElapsed();
  state.stats.prompts++;
  feed(`You → ${agent.def.name}: ${prompt}`);
  agent.transcript.push({ who: 'you', text: prompt });
  const reply = { who: 'agent', text: '' };
  agent.transcript.push(reply);
  agent.screen.startThinking(prompt);
  if (state.focused === agent || lastPanelAgent === agent) renderPanel(agent);

  const parser = new ReplyParser({
    onSay: (d) => {
      reply.text += d;
      if (lastPanelAgent === agent) renderPanel(agent);
    },
    onScreen: (d) => agent.screen.append(d),
    onSentence: (s) =>
      speaker.say(s, {
        index: agent.index,
        ...agent.def.voice,
        onStart: () => agent.speaking++,
        onEnd: () => (agent.speaking = Math.max(0, agent.speaking - 1)),
      }),
  });

  const history = agent.history.slice();
  try {
    for await (const chunk of streamReply({
      live: state.live,
      agentId: agent.id,
      history,
      prompt,
      office: state.feed.slice(-12),
      signal: ctrl.signal,
    })) {
      parser.push(chunk);
    }
    const { say, screen } = parser.end();
    if (!say && !screen) throw new Error('Empty reply');
    if (!screen) agent.screen.append(say);
    agent.history.push({ role: 'user', content: prompt }, { role: 'assistant', content: `SAY: ${say}\nSCREEN:\n${screen.slice(0, 4000)}` });
    if (agent.history.length > 24) agent.history.splice(0, agent.history.length - 24);
    const lines = screen.split('\n').filter((l) => l.trim()).length;
    const tests = (screen.match(/✓|\bPASS\b|passed/g) || []).length;
    state.stats.lines += lines;
    state.stats.tests += tests;
    feed(`${agent.def.name} shipped ${lines} lines${tests ? `, ${tests} green` : ''}`);
  } catch (err) {
    if (err.name === 'AbortError') return;
    agent.error = true;
    agent.screen.setError(err.message);
    reply.text = reply.text || `(${err.message})`;
    reply.who = 'agent err';
    feed(`${agent.def.name} crashed: ${err.message}`);
    toast(`${agent.def.name}: ${err.message}`);
    setTimeout(() => (agent.error = false), 6000);
  } finally {
    if (agent.abort === ctrl) {
      agent.busy = false;
      agent.abort = null;
    }
    if (lastPanelAgent === agent) renderPanel(agent);
  }
}

// ---------------------------------------------------------------- ambient office chatter
const AMBIENT = [
  () => `Deploy: ✓ deploy #${400 + Math.floor(Math.random() * 600)} to prod`,
  () => `Assert: ${200 + Math.floor(Math.random() * 800)} tests green`,
  () => `Tenx: -${10 + Math.floor(Math.random() * 300)} lines (deleted, faster now)`,
  () => `Critic approved PR #${1300 + Math.floor(Math.random() * 99)}`,
  () => `Vector: velocity ▲ ${(1 + Math.random() * 9).toFixed(1)}x week over week`,
];
let ambientIn = 8;

// ---------------------------------------------------------------- boot + loop
const timer = new THREE.Timer();
timer.connect(document);
let rosterTick = 0;

function loop(now) {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.05);
  const time = timer.getElapsed();

  movePlayer(dt);
  updateScreenView(dt);
  office.update(dt);

  state.focused = computeFocus();
  updateHint();

  for (const a of agents) {
    const events = a.update(dt, { playerPos: camera.position, focused: state.focused === a, pois: office.pois, time });
    events.forEach(feed);
  }

  ambientIn -= dt;
  if (ambientIn <= 0) {
    ambientIn = 12 + Math.random() * 16;
    feed(AMBIENT[Math.floor(Math.random() * AMBIENT.length)]());
  }

  office.board.update(dt, state.stats, state.feed);

  rosterTick -= dt;
  if (rosterTick <= 0) {
    rosterTick = 0.2;
    refreshRoster();
  }

  composer.render(dt);
  requestAnimationFrame(loop);
}

(async function boot() {
  if (!voiceSupport.listen) $('support').textContent = 'Heads up: this browser has no speech recognition (Chrome/Edge do). Typing still works.';
  const health = await checkHealth();
  state.live = Boolean(health.live);
  state.model = health.model || '';
  Object.assign(state.stats, { live: state.live, model: state.model });
  const mode = $('mode');
  mode.className = `mode ${state.live ? 'live' : 'sim'}`;
  mode.textContent = state.live
    ? `● LIVE: agents are powered by ${state.model}`
    : '● SIM MODE: canned agent brains. Set ANTHROPIC_API_KEY and run `npm run dev` to go live.';
  feed(state.live ? `Office online. Brains: ${state.model}` : 'Office online in sim mode');
})();

// Debug/automation handle (used by the smoke test; handy in the console too).
window.tennex = { state, agents, camera, ask: (id, text) => ask(byId[id], text), goToAgent: (i) => goToAgent(agents[i]), enterScreenView: (i) => enterScreenView(agents[i]) };

requestAnimationFrame(loop);
