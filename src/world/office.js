// Builds the Tennex office: room, desks (one per agent), the velocity wall,
// the manifesto whiteboard, a server rack, coffee, and a lounge.

import * as THREE from 'three';

export const ROOM = { w: 28, d: 20, h: 4 };
const HX = ROOM.w / 2;
const HZ = ROOM.d / 2;

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

function box(w, h, d, material, x, y, z, parent, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { canvas: c, texture: t };
}

// Where each agent works. `face` is the direction the seated agent looks (toward the wall).
export const DESK_SLOTS = [
  { x: -7, z: -HZ + 0.8, face: [0, -1] },
  { x: 0, z: -HZ + 0.8, face: [0, -1] },
  { x: 7, z: -HZ + 0.8, face: [0, -1] },
  { x: -4.5, z: HZ - 0.8, face: [0, 1] },
  { x: 4.5, z: HZ - 0.8, face: [0, 1] },
];

export function buildOffice(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const animated = [];
  const addCollider = (cx, cz, w, d) => colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });

  // ---------- Lighting ----------
  scene.add(new THREE.HemisphereLight('#c7d2ff', '#2a1a33', 1.7));
  const sun = new THREE.DirectionalLight('#fff1dd', 2.0);
  sun.position.set(6, 12, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 30 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  [
    ['#ff5a1f', -9, 3.2, 0],
    ['#a855f7', 0, 3.2, 0],
    ['#22d3ee', 9, 3.2, 0],
  ].forEach(([c, x, y, z]) => {
    const l = new THREE.PointLight(c, 18, 18, 1.4);
    l.position.set(x, y, z);
    scene.add(l);
  });

  // soft white fill over each desk row so faces and keyboards read well
  [-7, 0, 7].forEach((x) => {
    const l = new THREE.PointLight('#fff4e6', 6, 9, 1.5);
    l.position.set(x, 3.4, -7.5);
    scene.add(l);
  });
  [-4.5, 4.5].forEach((x) => {
    const l = new THREE.PointLight('#fff4e6', 6, 9, 1.5);
    l.position.set(x, 3.4, 7.5);
    scene.add(l);
  });

  // ---------- Floor / walls / ceiling ----------
  const floorTex = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#2a2b33';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2000; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.strokeStyle = 'rgba(120,130,255,0.18)';
    g.lineWidth = 3;
    g.strokeRect(0, 0, w, h);
  }).texture;
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(ROOM.w / 2, ROOM.d / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), std('#ffffff', { map: floorTex, roughness: 0.55 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), std('#15161d'));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = ROOM.h;
  group.add(ceil);

  const wallMat = std('#454a63');
  box(ROOM.w, ROOM.h, 0.2, wallMat, 0, ROOM.h / 2, -HZ - 0.1, group);
  box(ROOM.w, ROOM.h, 0.2, wallMat, 0, ROOM.h / 2, HZ + 0.1, group);
  box(0.2, ROOM.h, ROOM.d, wallMat, -HX - 0.1, ROOM.h / 2, 0, group);
  box(0.2, ROOM.h, ROOM.d, wallMat, HX + 0.1, ROOM.h / 2, 0, group);
  addCollider(0, -HZ - 0.1, ROOM.w + 1, 0.4);
  addCollider(0, HZ + 0.1, ROOM.w + 1, 0.4);
  addCollider(-HX - 0.1, 0, 0.4, ROOM.d + 1);
  addCollider(HX + 0.1, 0, 0.4, ROOM.d + 1);

  // Neon ceiling strips
  const neonColors = ['#ff5a1f', '#a855f7', '#22d3ee'];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshBasicMaterial({ color: neonColors[i] });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w - 4, 0.05, 0.08), m);
    strip.position.set(0, ROOM.h - 0.05, -5 + i * 5);
    group.add(strip);
  }
  // Baseboard glow
  [-HZ + 0.02, HZ - 0.02].forEach((z) => box(ROOM.w, 0.04, 0.02, new THREE.MeshBasicMaterial({ color: '#6366f1' }), 0, 0.05, z, group, { cast: false }));

  // ---------- Skyline windows (north wall, above the desks) ----------
  const sky = canvasTexture(2048, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0b1026');
    grad.addColorStop(0.55, '#5b2a86');
    grad.addColorStop(1, '#ff7a45');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    let x = 0;
    while (x < w) {
      const bw = 30 + Math.random() * 70;
      const bh = 60 + Math.random() * 170;
      g.fillStyle = '#0a0a14';
      g.fillRect(x, h - bh, bw, bh);
      for (let wy = h - bh + 8; wy < h - 6; wy += 12)
        for (let wx = x + 5; wx < x + bw - 5; wx += 10)
          if (Math.random() < 0.35) {
            g.fillStyle = Math.random() < 0.8 ? '#ffd28a' : '#7dd3fc';
            g.fillRect(wx, wy, 4, 6);
          }
      x += bw + 4;
    }
  }).texture;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w - 2, 1.5), new THREE.MeshBasicMaterial({ map: sky }));
  win.position.set(0, 2.85, -HZ + 0.01);
  group.add(win);
  for (let x = -HX + 1; x <= HX - 1; x += 3.25) box(0.08, 1.6, 0.06, std('#111'), x, 2.85, -HZ + 0.04, group, { cast: false });

  // ---------- e/acc neon sign (south wall) ----------
  const neon = canvasTexture(1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = '700 150px "Trebuchet MS", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ff3df2';
    g.shadowBlur = 40;
    g.fillStyle = '#ffd6ff';
    g.fillText('e/acc ⏩', w / 2, h / 2);
  }).texture;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: neon, transparent: true }));
  sign.position.set(0, 2.9, HZ - 0.02);
  sign.rotation.y = Math.PI;
  group.add(sign);

  // ---------- Desks ----------
  const desks = DESK_SLOTS.map((slot) => {
    const d = buildDesk(slot, group);
    addCollider(slot.x, slot.z, 2.0, 1.0);
    return d;
  });

  // ---------- Velocity wall (west) ----------
  const board = new VelocityBoard();
  const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.4), new THREE.MeshBasicMaterial({ map: board.texture, toneMapped: false }));
  boardMesh.position.set(-HX + 0.03, 2.05, 0);
  boardMesh.rotation.y = Math.PI / 2;
  group.add(boardMesh);
  box(0.04, 3.6, 9.2, std('#050505'), -HX, 2.05, 0, group, { cast: false });

  // ---------- Manifesto whiteboard (east) ----------
  const manifesto = canvasTexture(1200, 800, (g, w, h) => {
    g.fillStyle = '#f8fafc';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#0f172a';
    g.font = '700 64px "Segoe Print", "Marker Felt", "Comic Sans MS", cursive';
    g.fillText('THE TENNEX MANIFESTO', 60, 110);
    g.strokeStyle = '#ef4444';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(60, 135);
    g.lineTo(820, 128);
    g.stroke();
    const lines = [
      ['#2563eb', '1. Ship > talk'],
      ['#16a34a', '2. Tests are acceleration'],
      ['#9333ea', '3. Small diffs, compounding loops'],
      ['#ea580c', '4. Automate the boring. Then automate that.'],
      ['#0f172a', '5. Every agent is a 10x agent'],
      ['#db2777', '6. Up and to the right ↗'],
    ];
    g.font = '500 48px "Segoe Print", "Marker Felt", "Comic Sans MS", cursive';
    lines.forEach(([c, t], i) => {
      g.fillStyle = c;
      g.fillText(t, 70, 230 + i * 88);
    });
  }).texture;
  const wb = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.8), new THREE.MeshBasicMaterial({ map: manifesto, color: '#b9bec8' }));
  wb.position.set(HX - 0.04, 1.9, -3);
  wb.rotation.y = -Math.PI / 2;
  group.add(wb);
  box(0.04, 2.95, 4.35, std('#9ca3af', { metalness: 0.6, roughness: 0.3 }), HX, 1.9, -3, group, { cast: false });

  // ---------- Server rack (east, blinking) ----------
  const rack = new THREE.Group();
  rack.position.set(HX - 0.6, 0, 3.2);
  group.add(rack);
  box(0.9, 2.2, 1.0, std('#0b0b0f', { metalness: 0.5, roughness: 0.4 }), 0, 1.1, 0, rack);
  const ledGeo = new THREE.BoxGeometry(0.02, 0.03, 0.06);
  const leds = [];
  for (let r = 0; r < 14; r++)
    for (let c = 0; c < 6; c++) {
      const led = new THREE.Mesh(ledGeo, new THREE.MeshBasicMaterial({ color: '#22c55e' }));
      led.position.set(-0.46, 0.25 + r * 0.13, -0.3 + c * 0.1);
      rack.add(led);
      leds.push(led);
    }
  animated.push((t) => {
    for (let i = 0; i < leds.length; i++) {
      const on = Math.sin(t * (3 + (i % 7)) + i * 1.7) > 0.2;
      leds[i].material.color.set(on ? (i % 11 === 0 ? '#f59e0b' : '#22c55e') : '#052e16');
    }
  });
  addCollider(rack.position.x, rack.position.z, 1.0, 1.1);

  // ---------- Coffee station (east, south side) ----------
  const coffee = new THREE.Group();
  coffee.position.set(HX - 0.7, 0, 7.2);
  group.add(coffee);
  box(1.0, 0.95, 2.2, std('#3f2a1d'), 0, 0.475, 0, coffee);
  box(0.5, 0.6, 0.45, std('#d4d4d8', { metalness: 0.7, roughness: 0.25 }), 0, 1.25, -0.4, coffee);
  box(0.12, 0.08, 0.02, new THREE.MeshBasicMaterial({ color: '#f97316' }), -0.26, 1.4, -0.4, coffee, { cast: false }).rotation.y = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.11, 12), std(['#ff5a1f', '#a855f7', '#22c55e'][i]));
    cup.position.set(0, 1.0, 0.3 + i * 0.18);
    coffee.add(cup);
  }
  addCollider(coffee.position.x, coffee.position.z, 1.1, 2.3);

  // ---------- Lounge (center) ----------
  const rug = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), std('#312e81', { roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(1.5, 0.01, 0.5);
  rug.receiveShadow = true;
  group.add(rug);
  const couchMat = std('#7c2d12');
  const couch = new THREE.Group();
  couch.position.set(1.5, 0, 2.6);
  group.add(couch);
  box(3, 0.45, 0.9, couchMat, 0, 0.3, 0, couch);
  box(3, 0.6, 0.25, couchMat, 0, 0.75, 0.35, couch);
  box(0.25, 0.35, 0.9, couchMat, -1.4, 0.65, 0, couch);
  box(0.25, 0.35, 0.9, couchMat, 1.4, 0.65, 0, couch);
  addCollider(couch.position.x, couch.position.z, 3.1, 1.0);
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.06, 32), std('#e5e7eb', { roughness: 0.3 }));
  table.position.set(1.5, 0.45, 0.4);
  table.castShadow = true;
  group.add(table);
  box(0.08, 0.45, 0.08, std('#111'), 1.5, 0.22, 0.4, group);
  addCollider(1.5, 0.4, 1.3, 1.3);

  // Plants
  [
    [-HX + 0.8, -HZ + 3],
    [-HX + 0.8, HZ - 3],
    [HX - 0.8, -HZ + 0.8],
    [-2.2, 0.2],
    [10.5, HZ - 0.8],
  ].forEach(([x, z]) => {
    const p = new THREE.Group();
    p.position.set(x, 0, z);
    group.add(p);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.45, 16), std('#e7e5e4'));
    pot.position.y = 0.225;
    pot.castShadow = true;
    p.add(pot);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 - i * 0.03, 0), std('#15803d', { flatShading: true }));
      leaf.position.set((Math.random() - 0.5) * 0.3, 0.6 + i * 0.22, (Math.random() - 0.5) * 0.3);
      leaf.castShadow = true;
      p.add(leaf);
    }
    addCollider(x, z, 0.6, 0.6);
  });

  // Places agents like to wander to when idle.
  const pois = [
    { name: 'the coffee machine', pos: new THREE.Vector3(HX - 1.9, 0, 6.8), look: new THREE.Vector3(HX, 1, 6.8) },
    { name: 'the manifesto', pos: new THREE.Vector3(HX - 2.3, 0, -3), look: new THREE.Vector3(HX, 1.6, -3) },
    { name: 'the velocity wall', pos: new THREE.Vector3(-HX + 3, 0, 0.5), look: new THREE.Vector3(-HX, 1.8, 0.5) },
    { name: 'the server rack', pos: new THREE.Vector3(HX - 2.1, 0, 3.2), look: new THREE.Vector3(HX, 1, 3.2) },
    { name: 'the lounge', pos: new THREE.Vector3(-0.4, 0, -1.4), look: new THREE.Vector3(1.5, 1, 0.4) },
  ];

  let t = 0;
  return {
    group,
    colliders,
    desks,
    pois,
    board,
    update(dt) {
      t += dt;
      animated.forEach((f) => f(t));
    },
  };
}

function buildDesk(slot, parent) {
  const [fx, fz] = slot.face;
  const g = new THREE.Group();
  g.position.set(slot.x, 0, slot.z);
  g.rotation.y = Math.atan2(fx, fz); // local +Z = direction the agent faces
  parent.add(g);

  const top = std('#d6d3d1', { roughness: 0.4 });
  const metal = std('#27272a', { metalness: 0.6, roughness: 0.35 });
  box(1.9, 0.05, 0.85, top, 0, 0.75, 0, g);
  [[-0.9, -0.38], [0.9, -0.38], [-0.9, 0.38], [0.9, 0.38]].forEach(([x, z]) => box(0.05, 0.75, 0.05, metal, x, 0.375, z, g));

  // Monitor (screen faces the agent, i.e. local -Z)
  const monitor = new THREE.Group();
  monitor.position.set(0, 0.78, 0.2);
  g.add(monitor);
  box(0.25, 0.02, 0.18, metal, 0, 0.01, 0, monitor);
  box(0.05, 0.3, 0.05, metal, 0, 0.16, 0.02, monitor);
  box(1.24, 0.78, 0.05, std('#09090b', { metalness: 0.4, roughness: 0.3 }), 0, 0.62, 0.0, monitor);
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.7375), new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false }));
  screenMesh.position.set(0, 0.62, -0.027);
  screenMesh.rotation.y = Math.PI;
  monitor.add(screenMesh);

  // Keyboard + mug
  box(0.5, 0.02, 0.16, std('#18181b'), 0, 0.785, -0.2, g);
  box(0.08, 0.02, 0.1, std('#18181b'), 0.38, 0.785, -0.2, g);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 12), std('#fafafa'));
  mug.position.set(-0.7, 0.83, -0.1);
  g.add(mug);

  // Chair
  const chair = new THREE.Group();
  chair.position.set(0, 0, -0.85);
  g.add(chair);
  const chairMat = std('#18181b', { roughness: 0.5 });
  box(0.55, 0.08, 0.5, chairMat, 0, 0.47, 0, chair);
  box(0.55, 0.6, 0.07, chairMat, 0, 0.82, -0.26, chair);
  box(0.06, 0.45, 0.06, metal, 0, 0.22, 0, chair);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    box(0.3, 0.03, 0.04, metal, Math.cos(a) * 0.15, 0.03, Math.sin(a) * 0.15, chair).rotation.y = -a;
  }

  const toWorld = (v) => g.localToWorld(v.clone());
  return {
    group: g,
    screenMesh,
    chair,
    heading: g.rotation.y,
    seat: () => toWorld(new THREE.Vector3(0, 0, -0.78)),
    // Behind and to the right of the chair: where you stand to watch over the agent's shoulder.
    viewSpot: () => toWorld(new THREE.Vector3(-0.75, 0, -1.8)),
    screenCenter: () => screenMesh.getWorldPosition(new THREE.Vector3()),
    screenNormal: () => new THREE.Vector3(0, 0, -1).applyQuaternion(g.quaternion),
  };
}

// The giant wall display: exponential velocity chart + office stats + live feed.
export class VelocityBoard {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1800;
    this.canvas.height = 680;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.history = Array.from({ length: 80 }, (_, i) => 1 + Math.pow(1.045, i));
    this.t = 0;
    this.next = 0;
  }

  update(dt, stats, feed) {
    this.t += dt;
    this.next -= dt;
    if (this.next > 0) return;
    this.next = 0.25;
    const boost = 1.01 + stats.prompts * 0.002;
    const last = this.history[this.history.length - 1];
    this.history.push(last * boost + Math.random() * last * 0.01);
    if (this.history.length > 80) this.history.shift();
    this.draw(stats, feed);
    this.texture.needsUpdate = true;
  }

  draw(stats, feed) {
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#07040f');
    bg.addColorStop(1, '#140a24');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    g.font = '800 64px system-ui, sans-serif';
    g.fillStyle = '#fff';
    g.fillText('TENNEX', 50, 90);
    g.fillStyle = '#ff5a1f';
    g.fillText('// ACCELERATE', 330, 90);
    g.font = '600 26px ui-monospace, Menlo, monospace';
    g.fillStyle = stats.live ? '#4ade80' : '#fbbf24';
    g.fillText(stats.live ? `● LIVE · ${stats.model}` : '● SIM MODE · add ANTHROPIC_API_KEY to go live', 50, 135);
    if (stats.brief) {
      g.font = '500 22px ui-monospace, Menlo, monospace';
      g.fillStyle = '#e9d5ff';
      g.fillText(`BRIEF: ${stats.brief.length > 80 ? stats.brief.slice(0, 79) + '…' : stats.brief}`, 50, 162);
    }

    // chart
    const x0 = 50, y0 = 185, w = 1050, h = 315;
    const max = Math.max(...this.history);
    const min = Math.min(...this.history);
    g.strokeStyle = 'rgba(168,85,247,0.2)';
    g.lineWidth = 2;
    for (let i = 0; i <= 5; i++) {
      g.beginPath();
      g.moveTo(x0, y0 + (h * i) / 5);
      g.lineTo(x0 + w, y0 + (h * i) / 5);
      g.stroke();
    }
    const pt = (v, i) => [x0 + (w * i) / (this.history.length - 1), y0 + h - ((v - min) / (max - min || 1)) * h];
    const grad = g.createLinearGradient(0, y0, 0, y0 + h);
    grad.addColorStop(0, 'rgba(255,90,31,0.5)');
    grad.addColorStop(1, 'rgba(168,85,247,0)');
    g.beginPath();
    this.history.forEach((v, i) => (i ? g.lineTo(...pt(v, i)) : g.moveTo(...pt(v, i))));
    g.lineTo(x0 + w, y0 + h);
    g.lineTo(x0, y0 + h);
    g.fillStyle = grad;
    g.fill();
    g.beginPath();
    this.history.forEach((v, i) => (i ? g.lineTo(...pt(v, i)) : g.moveTo(...pt(v, i))));
    g.strokeStyle = '#ff8a4c';
    g.lineWidth = 6;
    g.shadowColor = '#ff5a1f';
    g.shadowBlur = 20;
    g.stroke();
    g.shadowBlur = 0;

    // stats
    const tiles = [
      ['PROMPTS', stats.prompts],
      ['LINES SHIPPED', stats.lines],
      ['TESTS GREEN', stats.tests],
      ['AGENTS ONLINE', stats.agents],
    ];
    tiles.forEach(([k, v], i) => {
      const x = x0 + (w / 4) * i;
      g.font = '600 24px ui-monospace, Menlo, monospace';
      g.fillStyle = '#a78bfa';
      g.fillText(k, x, 560);
      g.font = '800 64px system-ui, sans-serif';
      g.fillStyle = '#fafafa';
      g.fillText(String(v), x, 630);
    });

    // feed
    const fx = 1150;
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(fx, 40, W - fx - 40, H - 80);
    g.font = '700 30px ui-monospace, Menlo, monospace';
    g.fillStyle = '#22d3ee';
    g.fillText('OFFICE FEED', fx + 24, 90);
    g.font = '500 22px ui-monospace, Menlo, monospace';
    const items = feed.slice(-17);
    items.forEach((line, i) => {
      g.fillStyle = i === items.length - 1 ? '#fff' : `rgba(226,232,240,${0.35 + (0.65 * i) / items.length})`;
      g.fillText(line.length > 46 ? line.slice(0, 45) + '…' : line, fx + 24, 135 + i * 31);
    });
  }
}
