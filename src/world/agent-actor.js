// One agent in the world: body + desk + monitor + conversation + idle life.

import * as THREE from 'three';
import { Character } from './character.js';
import { AgentScreen } from './screen.js';

const STATUS = {
  autopilot: ['#9ca3af', 'autopilot'],
  break: ['#60a5fa', 'on a break'],
  listening: ['#f472b6', 'listening'],
  thinking: ['#fbbf24', 'thinking'],
  typing: ['#4ade80', 'shipping'],
  talking: ['#f97316', 'talking'],
  error: ['#ef4444', 'crashed'],
};

export class AgentActor {
  constructor(def, desk, index, scene) {
    this.def = def;
    this.id = def.id;
    this.index = index;
    this.desk = desk;
    this.character = new Character(def);
    this.screen = new AgentScreen(def);
    desk.screenMesh.material.dispose();
    desk.screenMesh.material = new THREE.MeshBasicMaterial({ map: this.screen.texture, toneMapped: false });
    scene.add(this.character.root);

    this.history = []; // [{role, content}] sent to the API
    this.transcript = []; // [{who: 'you'|'agent', text}] shown in the HUD
    this.busy = false;
    this.speaking = 0;
    this.listening = false;
    this.error = false;
    this.abort = null;
    this.lastPromptAt = -Infinity;

    // idle life
    this.mode = 'seated'; // seated | standing-up | walking | visiting | returning
    this.breakIn = 25 + Math.random() * 60;
    this.target = null;
    this.poi = null;
    this.timer = 0;
    this.swivel = 0;

    const seat = desk.seat();
    this.character.root.position.copy(seat);
    this.character.root.rotation.y = desk.heading;
    this.character.setPose('sit');

    this.#buildTag();
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.68, 40),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.visible = false;
    this.character.root.add(this.ring);
    this.setStatus('autopilot');
  }

  get position() {
    return this.character.root.position;
  }

  get atDesk() {
    return this.mode === 'seated';
  }

  #buildTag() {
    this.tagCanvas = document.createElement('canvas');
    this.tagCanvas.width = 512;
    this.tagCanvas.height = 160;
    this.tagTex = new THREE.CanvasTexture(this.tagCanvas);
    this.tagTex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, depthTest: false, transparent: true }));
    this.tag.scale.set(1.2, 0.375, 1);
    this.tag.position.y = 2.2;
    this.tag.renderOrder = 10;
    this.character.root.add(this.tag);
  }

  setStatus(key) {
    if (this.status === key) return;
    this.status = key;
    const [color, label] = STATUS[key];
    const g = this.tagCanvas.getContext('2d');
    g.clearRect(0, 0, 512, 160);
    g.fillStyle = 'rgba(8,8,14,0.78)';
    g.beginPath();
    g.roundRect(6, 6, 500, 148, 26);
    g.fill();
    g.fillStyle = this.def.color;
    g.fillRect(6, 30, 8, 100);
    g.font = '800 54px system-ui, sans-serif';
    g.fillStyle = '#fff';
    g.fillText(this.def.name, 34, 68);
    g.font = '500 28px system-ui, sans-serif';
    g.fillStyle = '#a1a1aa';
    g.fillText(this.def.title, 34, 110);
    g.fillStyle = color;
    g.beginPath();
    g.arc(40, 136, 8, 0, Math.PI * 2);
    g.fill();
    g.font = '600 24px ui-monospace, Menlo, monospace';
    g.fillText(label, 56, 144);
    const labelW = g.measureText(label).width;
    g.fillStyle = '#52525b';
    g.fillText(`[${this.index + 1}]`, Math.max(56 + labelW + 16, 440), 144);
    this.tagTex.needsUpdate = true;
  }

  // ---- idle life ----
  #goTo(pos, next) {
    this.target = pos.clone();
    this.after = next;
    this.character.setPose('walk');
  }

  #startBreak(pois) {
    this.poi = pois[Math.floor(Math.random() * pois.length)];
    this.mode = 'standing-up';
    this.timer = 0.6;
    this.character.setPose('stand');
    this.setStatus('break');
    // step out from the desk first so nobody walks through furniture
    this.character.root.position.copy(this.desk.viewSpot().lerp(this.desk.seat(), 0.4));
    return `${this.def.name} wandered over to ${this.poi.name}`;
  }

  #returnToDesk() {
    this.mode = 'returning';
    const out = this.desk.viewSpot().lerp(this.desk.seat(), 0.4);
    this.#goTo(out, () => {
      this.#goTo(this.desk.seat(), () => {
        this.mode = 'seated';
        this.character.setPose('sit');
        this.character.root.rotation.y = this.desk.heading;
        this.breakIn = 40 + Math.random() * 70;
        if (this.status === 'break') this.setStatus('autopilot');
      });
    });
  }

  // Called when the human engages: stop wandering and pay attention.
  summon() {
    this.breakIn = Math.max(this.breakIn, 60);
  }

  update(dt, { playerPos, focused, pois, time }) {
    const events = [];
    const root = this.character.root;
    const engaged = focused || this.busy || this.speaking > 0 || this.listening;
    this.ring.visible = focused;
    // The HUD already names who you're next to; a giant tag in your face helps nobody.
    this.tag.visible = !playerPos || playerPos.distanceTo(root.position) > 2.6;
    if (focused) this.ring.material.opacity = 0.5 + 0.3 * Math.sin(time * 4);

    // walking
    if (this.target) {
      const d = this.target.clone().sub(root.position);
      d.y = 0;
      const dist = d.length();
      if (dist < 0.05) {
        root.position.copy(this.target);
        this.target = null;
        this.character.setPose('stand');
        const f = this.after;
        this.after = null;
        f?.();
      } else {
        const step = Math.min(dist, dt * 1.5);
        root.position.addScaledVector(d.normalize(), step);
        const want = Math.atan2(d.x, d.z);
        root.rotation.y = lerpAngle(root.rotation.y, want, Math.min(1, dt * 10));
      }
    }

    if (this.mode === 'seated') {
      this.breakIn -= dt;
      if (this.breakIn <= 0 && !engaged && time - this.lastPromptAt > 45) events.push(this.#startBreak(pois));
      // swivel the chair toward the human while talking
      let want = 0;
      if (engaged && playerPos) {
        const to = playerPos.clone().sub(root.position);
        const rel = wrapAngle(Math.atan2(to.x, to.z) - this.desk.heading);
        want = THREE.MathUtils.clamp(rel, -1.2, 1.2) * (this.busy && !this.speaking ? 0.35 : 0.8);
      }
      this.swivel += (want - this.swivel) * Math.min(1, dt * 3);
      root.rotation.y = this.desk.heading + this.swivel;
      this.desk.chair.rotation.y = this.swivel;
    } else if (this.mode === 'standing-up') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.mode = 'walking';
        this.#goTo(this.poi.pos, () => {
          this.mode = 'visiting';
          this.timer = 6 + Math.random() * 8;
        });
      }
    } else if (this.mode === 'visiting') {
      this.timer -= dt;
      if (!engaged) {
        const want = Math.atan2(this.poi.look.x - root.position.x, this.poi.look.z - root.position.z);
        root.rotation.y = lerpAngle(root.rotation.y, want, Math.min(1, dt * 4));
      } else if (playerPos) {
        const want = Math.atan2(playerPos.x - root.position.x, playerPos.z - root.position.z);
        root.rotation.y = lerpAngle(root.rotation.y, want, Math.min(1, dt * 4));
        this.timer = Math.max(this.timer, 4);
      }
      if (this.timer <= 0) this.#returnToDesk();
    }

    // status
    if (this.error) this.setStatus('error');
    else if (this.speaking > 0) this.setStatus('talking');
    else if (this.listening) this.setStatus('listening');
    else if (this.busy) this.setStatus(this.screen.mode === 'thinking' ? 'thinking' : 'typing');
    else if (this.mode !== 'seated') this.setStatus('break');
    else this.setStatus('autopilot');

    const typing = this.mode === 'seated' ? (this.busy && this.screen.mode === 'output' ? 1 : this.speaking ? 0 : 0.45) : 0;
    this.character.update(dt, {
      typing,
      talking: this.speaking > 0,
      lookAt: engaged && playerPos ? playerPos : null,
      hype: this.busy,
    });
    this.screen.update(dt, this.busy);

    // return the screen to autopilot a while after the last answer
    if (!this.busy && this.screen.mode !== 'idle' && time - this.lastPromptAt > 120) this.screen.backToIdle();
    return events;
  }
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}
