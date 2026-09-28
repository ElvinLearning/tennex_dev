// Live monitor contents, drawn to a canvas and used as a three.js texture.
// Idle: each app type "works" on its own. Prompted: shows the agent's streamed SCREEN output.

import * as THREE from 'three';

const W = 1024;
const H = 640;
const FONT = 20;
const LH = 25;
const PAD = 18;
const BAR = 40;
const MAX_COLS = 78;

const THEMES = {
  editor: { bg: '#15161e', bar: '#0d0e14', fg: '#c0caf5' },
  tests: { bg: '#0f1a14', bar: '#0a120d', fg: '#d1fae5' },
  dashboard: { bg: '#120b1f', bar: '#0b0714', fg: '#e9d5ff' },
  terminal: { bg: '#0b0f14', bar: '#06090c', fg: '#e2e8f0' },
  review: { bg: '#0d1117', bar: '#010409', fg: '#e6edf3' },
};

const KEYWORDS =
  /\b(import|from|export|const|let|var|function|async|await|return|if|else|for|while|class|new|type|interface|def|fn|pub|use|impl|struct|describe|it|expect|true|false|null|undefined)\b/g;

const IDLE = {
  editor: [
    `export function shipIt(feature: Feature) {\n  const diff = feature.smallest();\n  return deploy(diff, { requireTests: true });\n}\n`,
    `// hot path: 10x faster by doing 10x less\nfor (const job of queue.drain()) {\n  if (seen.has(job.id)) continue;\n  seen.add(job.id);\n  await run(job);\n}\n`,
    `pub fn accelerate(v: f64, dt: f64) -> f64 {\n    v * (1.0 + dt).powf(10.0)\n}\n`,
    `const cache = new Map<string, Promise<Result>>();\nexport const memo = (k: string, f: () => Promise<Result>) =>\n  cache.get(k) ?? (cache.set(k, f()), cache.get(k)!);\n`,
  ],
  terminal: [
    '$ terraform apply -auto-approve',
    '  + aws_ecs_service.office  (1 to add)',
    'Apply complete! Resources: 1 added, 0 changed.',
    '$ kubectl get pods -n prod',
    'office-7d9f8c-x2x    1/1   Running   0   3m',
    'office-7d9f8c-q8w    1/1   Running   0   3m',
    '$ curl -s prod/healthz',
    '{"ok":true,"version":"1.4.2"}',
    '$ gh run watch',
    '✓ ship.yml  main  build+test+deploy  1m12s',
    '[warn] disk 71% on node-3, auto-scaling',
    '✓ node-4 joined the cluster',
  ],
  review: [
    '@@ -41,6 +41,8 @@ async function handler(req) {',
    '-  const user = JSON.parse(req.body);',
    '+  const user = UserSchema.parse(JSON.parse(req.body));',
    ' 💬 Critic: parse, don\'t cast.',
    '-  await db.query(`SELECT * FROM t WHERE id=${id}`);',
    '+  await db.query("SELECT * FROM t WHERE id=$1", [id]);',
    ' 💬 Critic: SQL injection. Blocking.',
    '+  if (!rows.length) return notFound();',
    ' ✅ LGTM after that. Nice work.',
  ],
};

const TEST_NAMES = [
  'office > renders 5 agents',
  'parser > splits SAY/SCREEN',
  'voice > push-to-talk ends cleanly',
  'deploy > rollback in < 30s',
  'velocity > is exponential',
  'agents > hand off work by name',
  'api > rejects unknown agent',
  'cache > hit rate > 90%',
];

function wrap(text) {
  const out = [];
  for (const raw of text.replace(/\t/g, '  ').split('\n')) {
    if (raw.length <= MAX_COLS) out.push(raw);
    else for (let i = 0; i < raw.length; i += MAX_COLS) out.push(raw.slice(i, i + MAX_COLS));
  }
  return out;
}

function lineColor(line, fg) {
  const t = line.trimStart();
  if (/^(\+(?!\+)|✓|✅|PASS|\s*Tests?.*passed)/.test(t) && !/failed/.test(t)) return '#4ade80';
  if (/^(-(?!-)|✗|×|FAIL|Error|error)/.test(t)) return '#f87171';
  if (/^(\/\/|#(?!!)|--\s)/.test(t)) return '#6b7280';
  if (/^(\$ |> )/.test(t)) return '#67e8f9';
  if (/^(@@|💬)/.test(t)) return '#c4b5fd';
  if (/(WARN|warn|⚠)/.test(t)) return '#fbbf24';
  if (/^[A-Z][A-Z0-9 :_/.-]{3,}$/.test(t)) return '#f0abfc';
  return fg;
}

export class AgentScreen {
  constructor(agent) {
    this.agent = agent;
    this.app = agent.screenApp;
    this.theme = THEMES[this.app];
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    this.mode = 'idle'; // idle | thinking | output
    this.prompt = '';
    this.output = '';
    this.idleText = '';
    this.idleLines = [];
    this.idleT = 0;
    this.snippet = 0;
    this.char = 0;
    this.tests = [];
    this.series = Array.from({ length: 60 }, (_, i) => Math.exp(i / 18) + Math.random());
    this.t = 0;
    this.redrawIn = 0;
    this.speed = 1;
    this.scroll = 0; // lines scrolled up from the bottom
    this.#seedIdle();
  }

  #seedIdle() {
    if (this.app === 'terminal' || this.app === 'review') this.idleLines = IDLE[this.app].slice(0, 4);
  }

  scrollBy(lines) {
    this.scroll = Math.max(0, this.scroll + lines);
    this.redrawIn = 0;
  }

  // What's on screen as plain text, for copying.
  get text() {
    return this.mode === 'output' ? this.output : '';
  }

  startThinking(prompt) {
    this.scroll = 0;
    this.mode = 'thinking';
    this.prompt = prompt;
    this.output = '';
  }

  append(delta) {
    this.mode = 'output';
    this.output += delta;
  }

  setError(msg) {
    this.mode = 'output';
    this.output += `\n✗ ${msg}\n`;
  }

  backToIdle() {
    this.mode = 'idle';
  }

  update(dt, busy) {
    this.t += dt;
    this.speed = busy ? 4 : 1;
    if (this.mode === 'idle') this.#tickIdle(dt);
    this.redrawIn -= dt;
    if (this.redrawIn > 0) return;
    this.redrawIn = 1 / 20;
    this.draw();
    this.texture.needsUpdate = true;
  }

  #tickIdle(dt) {
    this.idleT += dt * this.speed;
    if (this.app === 'editor') {
      const src = IDLE.editor[this.snippet % IDLE.editor.length];
      this.char = Math.min(src.length, this.char + dt * 22 * this.speed);
      this.idleText = src.slice(0, Math.floor(this.char));
      if (this.char >= src.length && this.idleT > 12) {
        this.snippet++;
        this.char = 0;
        this.idleT = 0;
      }
    } else if (this.app === 'terminal' || this.app === 'review') {
      if (this.idleT > 1.1) {
        this.idleT = 0;
        const src = IDLE[this.app];
        this.idleLines.push(src[this.idleLines.length % src.length]);
        if (this.idleLines.length > 60) this.idleLines.splice(0, 20);
      }
    } else if (this.app === 'tests') {
      if (this.idleT > 0.45) {
        this.idleT = 0;
        if (this.tests.length >= TEST_NAMES.length + 3) this.tests = [];
        else this.tests.push(TEST_NAMES[this.tests.length % TEST_NAMES.length]);
      }
    } else if (this.app === 'dashboard') {
      if (this.idleT > 0.5) {
        this.idleT = 0;
        const last = this.series[this.series.length - 1];
        this.series.push(last * 1.03 + Math.random() * 2);
        if (this.series.length > 60) this.series.shift();
      }
    }
  }

  draw() {
    const { ctx, theme } = this;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);
    // title bar
    ctx.fillStyle = theme.bar;
    ctx.fillRect(0, 0, W, BAR);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(22 + i * 22, BAR / 2, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.font = `600 18px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.fillStyle = '#9ca3af';
    ctx.textBaseline = 'middle';
    const title = this.mode === 'idle' ? this.agent.screenTitle : `${this.agent.name.toLowerCase()} — working on your prompt`;
    ctx.fillText(title, 100, BAR / 2);
    ctx.fillStyle = this.agent.color;
    ctx.fillRect(W - 110, 12, 92, 16);
    ctx.fillStyle = '#000';
    ctx.font = `700 13px ui-monospace, Menlo, monospace`;
    ctx.fillText(this.mode === 'idle' ? 'AUTOPILOT' : 'PROMPTED', W - 104, BAR / 2 + 1);
    ctx.textBaseline = 'alphabetic';

    if (this.mode === 'thinking') return this.#drawThinking();
    if (this.mode === 'output') return this.#drawText(`> ${this.prompt}\n\n${this.output}`, true);
    if (this.app === 'dashboard') return this.#drawDashboard();
    if (this.app === 'tests') return this.#drawTests();
    if (this.app === 'editor') return this.#drawText(this.idleText, true, true);
    return this.#drawText(this.idleLines.join('\n'), true);
  }

  #drawText(text, cursor, numbers = false) {
    const { ctx, theme } = this;
    const lines = wrap(text);
    const rows = Math.floor((H - BAR - PAD * 2) / LH);
    const maxScroll = Math.max(0, lines.length - rows);
    if (this.scroll > maxScroll) this.scroll = maxScroll;
    const start = maxScroll - this.scroll;
    const end = Math.min(lines.length, start + rows);
    ctx.font = `${FONT}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    const x0 = numbers ? PAD + 44 : PAD;
    for (let i = start; i < end; i++) {
      const y = BAR + PAD + (i - start + 1) * LH - 6;
      if (numbers) {
        ctx.fillStyle = '#3b4261';
        ctx.fillText(String(i + 1).padStart(3), PAD - 4, y);
      }
      this.#drawLine(lines[i], x0, y, lineColor(lines[i], theme.fg));
    }
    if (this.scroll > 0) {
      ctx.fillStyle = this.agent.color;
      ctx.font = `700 16px ui-monospace, Menlo, monospace`;
      ctx.fillText(`▼ ${this.scroll} more`, W - 150, H - 12);
      ctx.font = `${FONT}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    }
    if (cursor && this.scroll === 0 && Math.floor(this.t * 2) % 2 === 0) {
      const last = lines[lines.length - 1] ?? '';
      const y = BAR + PAD + (lines.length - start) * LH - 6;
      ctx.fillStyle = this.agent.color;
      ctx.fillRect(x0 + ctx.measureText(last).width + 2, y - FONT + 3, 11, FONT);
    }
  }

  #drawLine(line, x, y, color) {
    const { ctx } = this;
    if (color !== this.theme.fg) {
      ctx.fillStyle = color;
      ctx.fillText(line, x, y);
      return;
    }
    // light syntax highlighting: keywords + strings
    let cx = x;
    const parts = line.split(/("[^"]*"|'[^']*'|`[^`]*`)/);
    for (const part of parts) {
      if (/^["'`]/.test(part)) {
        ctx.fillStyle = '#9ece6a';
        ctx.fillText(part, cx, y);
        cx += ctx.measureText(part).width;
        continue;
      }
      let last = 0;
      for (const m of part.matchAll(KEYWORDS)) {
        const pre = part.slice(last, m.index);
        ctx.fillStyle = color;
        ctx.fillText(pre, cx, y);
        cx += ctx.measureText(pre).width;
        ctx.fillStyle = '#bb9af7';
        ctx.fillText(m[0], cx, y);
        cx += ctx.measureText(m[0]).width;
        last = m.index + m[0].length;
      }
      const rest = part.slice(last);
      ctx.fillStyle = color;
      ctx.fillText(rest, cx, y);
      cx += ctx.measureText(rest).width;
    }
  }

  #drawThinking() {
    const { ctx } = this;
    this.#drawText(`> ${this.prompt}`, false);
    const cx = W / 2;
    const cy = H / 2 + 30;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + this.t * 4;
      ctx.globalAlpha = 0.15 + 0.85 * ((i / 12 + this.t) % 1);
      ctx.fillStyle = this.agent.color;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 48, cy + Math.sin(a) * 48, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = `600 24px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#e5e7eb';
    ctx.textAlign = 'center';
    ctx.fillText('thinking' + '.'.repeat(1 + (Math.floor(this.t * 3) % 3)), cx, cy + 100);
    ctx.textAlign = 'left';
  }

  #drawTests() {
    const { ctx } = this;
    ctx.font = `${FONT}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#67e8f9';
    ctx.fillText('$ vitest --watch', PAD, BAR + PAD + LH - 6);
    const done = Math.min(this.tests.length, TEST_NAMES.length);
    for (let i = 0; i < done; i++) {
      const y = BAR + PAD + (i + 2) * LH;
      ctx.fillStyle = '#4ade80';
      ctx.fillText(` ✓ ${this.tests[i]}`, PAD, y);
      ctx.fillStyle = '#6b7280';
      ctx.fillText(`${(i * 7) % 13 + 1}ms`, W - 90, y);
    }
    const barY = H - 90;
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(PAD, barY, W - PAD * 2, 22);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(PAD, barY, ((W - PAD * 2) * done) / TEST_NAMES.length, 22);
    ctx.font = `700 ${FONT + 2}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = done === TEST_NAMES.length ? '#4ade80' : '#e5e7eb';
    ctx.fillText(
      done === TEST_NAMES.length ? ` Tests  ${done} passed (${done})  ✓ ALL GREEN` : ` running… ${done}/${TEST_NAMES.length}`,
      PAD,
      H - 34,
    );
  }

  #drawDashboard() {
    const { ctx } = this;
    const x0 = PAD + 10;
    const y0 = BAR + 90;
    const w = W - PAD * 2 - 20;
    const h = 300;
    ctx.font = `700 26px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#f0abfc';
    ctx.fillText('SHIPPING VELOCITY', x0, BAR + 50);
    const last = this.series[this.series.length - 1];
    ctx.fillStyle = '#4ade80';
    ctx.textAlign = 'right';
    ctx.fillText(`▲ ${(last / this.series[0]).toFixed(1)}x`, W - PAD - 10, BAR + 50);
    ctx.textAlign = 'left';
    const max = Math.max(...this.series);
    ctx.strokeStyle = '#2e1065';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x0, y0 + (h * i) / 4);
      ctx.lineTo(x0 + w, y0 + (h * i) / 4);
      ctx.stroke();
    }
    const grad = ctx.createLinearGradient(0, y0, 0, y0 + h);
    grad.addColorStop(0, 'rgba(168,85,247,0.55)');
    grad.addColorStop(1, 'rgba(168,85,247,0)');
    ctx.beginPath();
    this.series.forEach((v, i) => {
      const x = x0 + (w * i) / (this.series.length - 1);
      const y = y0 + h - (h * v) / max;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.lineTo(x0 + w, y0 + h);
    ctx.lineTo(x0, y0 + h);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    this.series.forEach((v, i) => {
      const x = x0 + (w * i) / (this.series.length - 1);
      const y = y0 + h - (h * v) / max;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = '#d8b4fe';
    ctx.lineWidth = 4;
    ctx.stroke();
    const kpis = [
      ['deploys/day', Math.round(last)],
      ['tests', `${(98 + Math.sin(this.t) * 1.5).toFixed(1)}%`],
      ['open PRs', 3],
      ['kardashev', `${(0.73 + last / 1e5).toFixed(4)}`],
    ];
    ctx.font = `600 20px ui-monospace, Menlo, monospace`;
    kpis.forEach(([k, v], i) => {
      const x = x0 + (w / 4) * i;
      ctx.fillStyle = '#a78bfa';
      ctx.fillText(k, x, H - 70);
      ctx.fillStyle = '#fafafa';
      ctx.font = `700 30px ui-monospace, Menlo, monospace`;
      ctx.fillText(String(v), x, H - 32);
      ctx.font = `600 20px ui-monospace, Menlo, monospace`;
    });
  }
}
