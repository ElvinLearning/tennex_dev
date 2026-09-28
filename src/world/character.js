// Procedural low-poly agent: pivot-rigged so it can sit & type, walk, turn its
// head toward you, and flap its mouth while speaking. Faces local +Z.

import * as THREE from 'three';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...extra });

function mesh(geo, material, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

function limb(upperLen, lowerLen, radius, upperMat, lowerMat, endGeo, endMat) {
  const upper = new THREE.Group();
  upper.add(mesh(new THREE.CapsuleGeometry(radius, upperLen - radius * 2, 4, 8), upperMat, { y: -upperLen / 2 }));
  const joint = new THREE.Group();
  joint.position.y = -upperLen;
  upper.add(joint);
  joint.add(mesh(new THREE.CapsuleGeometry(radius * 0.9, lowerLen - radius * 2, 4, 8), lowerMat, { y: -lowerLen / 2 }));
  if (endGeo) joint.add(mesh(endGeo, endMat, { y: -lowerLen, z: endGeo.userData.z ?? 0 }));
  return { upper, joint };
}

export const HIP_STAND = 0.92;
export const HIP_SIT = 0.54;

export class Character {
  constructor(agent) {
    const look = agent.look;
    this.agent = agent;
    this.root = new THREE.Group();
    this.root.name = agent.id;

    const skin = mat(look.skin);
    const shirt = mat(look.shirt);
    const pants = mat(look.pants);
    const shoe = mat('#111827');
    const accent = mat(agent.color, { emissive: agent.color, emissiveIntensity: 0.25 });

    this.hips = new THREE.Group();
    this.hips.position.y = HIP_STAND;
    this.root.add(this.hips);

    // Legs
    const footGeo = new THREE.BoxGeometry(0.13, 0.08, 0.26);
    footGeo.userData.z = 0.06;
    this.legs = [-1, 1].map((side) => {
      const l = limb(0.46, 0.46, 0.085, pants, pants, footGeo, shoe);
      l.upper.position.set(side * 0.11, 0, 0);
      this.hips.add(l.upper);
      return l;
    });

    // Torso
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    this.torso.add(mesh(new THREE.CapsuleGeometry(0.21, 0.32, 6, 12), shirt, { y: 0.33 }));
    this.torso.add(mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05), accent, { y: 0.4, z: 0.2 })); // chest badge stripe

    // Arms
    const handGeo = new THREE.SphereGeometry(0.06, 10, 8);
    this.arms = [-1, 1].map((side) => {
      const a = limb(0.32, 0.3, 0.06, shirt, skin, handGeo, skin);
      a.upper.position.set(side * 0.28, 0.56, 0);
      a.upper.rotation.z = side * 0.08;
      this.torso.add(a.upper);
      return a;
    });

    // Head
    this.head = new THREE.Group();
    this.head.position.y = 0.72;
    this.torso.add(this.head);
    this.head.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 10), skin, { y: -0.02 }));
    this.head.add(mesh(new THREE.SphereGeometry(0.17, 20, 16), skin, { y: 0.14 }));
    const eyeMat =
      look.accessory === 'lasereyes'
        ? new THREE.MeshStandardMaterial({ color: '#ff1a1a', emissive: '#ff0000', emissiveIntensity: 4 })
        : mat('#111111');
    this.eyes = [-1, 1].map((s) => {
      const e = mesh(new THREE.SphereGeometry(look.accessory === 'lasereyes' ? 0.03 : 0.022, 10, 8), eyeMat, {
        x: s * 0.06,
        y: 0.16,
        z: 0.155,
      });
      this.head.add(e);
      return e;
    });
    this.mouth = mesh(new THREE.BoxGeometry(0.07, 0.015, 0.02), mat('#3f1d1d'), { y: 0.08, z: 0.16 });
    this.head.add(this.mouth);

    this.#addHair(look);
    this.#addAccessory(look, agent);

    // Anim state
    this.pose = 'stand'; // stand | sit | walk
    this.phase = Math.random() * 10;
    this.talk = 0;
    this.blinkIn = 2 + Math.random() * 3;
    this.headYaw = 0;
    this.headPitch = 0;
  }

  #addHair(look) {
    const hair = mat(look.hairColor, { roughness: 0.9 });
    const h = this.head;
    switch (look.hair) {
      case 'spiky':
        h.add(mesh(new THREE.SphereGeometry(0.175, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), hair, { y: 0.15 }));
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          h.add(
            mesh(new THREE.ConeGeometry(0.045, 0.14, 6), hair, {
              x: Math.cos(a) * 0.09,
              y: 0.3,
              z: Math.sin(a) * 0.09,
              rx: Math.sin(a) * 0.5,
              rz: -Math.cos(a) * 0.5,
            }),
          );
        }
        break;
      case 'bun':
        h.add(mesh(new THREE.SphereGeometry(0.178, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.9), hair, { y: 0.14 }));
        h.add(mesh(new THREE.SphereGeometry(0.08, 12, 10), hair, { y: 0.32, z: -0.08 }));
        break;
      case 'slick':
        h.add(mesh(new THREE.SphereGeometry(0.18, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), hair, { y: 0.15, rx: -0.25, z: -0.01 }));
        break;
      case 'beret':
        h.add(mesh(new THREE.SphereGeometry(0.176, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), mat('#3b2314'), { y: 0.14 }));
        h.add(mesh(new THREE.CylinderGeometry(0.19, 0.17, 0.05, 20), hair, { y: 0.3, rz: 0.25, x: 0.03 }));
        break;
      default:
        h.add(mesh(new THREE.SphereGeometry(0.176, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.3), hair, { y: 0.14 }));
    }
  }

  #addAccessory(look, agent) {
    const h = this.head;
    switch (look.accessory) {
      case 'headphones': {
        const m = mat('#e5e7eb', { metalness: 0.4, roughness: 0.3 });
        h.add(mesh(new THREE.TorusGeometry(0.19, 0.02, 8, 24, Math.PI), m, { y: 0.14 }));
        [-1, 1].forEach((s) =>
          h.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16), mat(agent.color, { emissive: agent.color, emissiveIntensity: 0.6 }), { x: s * 0.19, y: 0.13, rz: Math.PI / 2 })),
        );
        break;
      }
      case 'goggles': {
        h.add(mesh(new THREE.TorusGeometry(0.178, 0.015, 6, 28), mat('#111'), { y: 0.25, rx: Math.PI / 2 }));
        [-1, 1].forEach((s) =>
          h.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 14), mat('#22c55e', { emissive: '#22c55e', emissiveIntensity: 1.2, transparent: true, opacity: 0.8 }), { x: s * 0.065, y: 0.26, z: 0.15, rx: Math.PI / 2 - 0.4 })),
        );
        break;
      }
      case 'hardhat': {
        const y = mat('#facc15', { roughness: 0.4 });
        h.add(mesh(new THREE.SphereGeometry(0.19, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), y, { y: 0.19 }));
        h.add(mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 24), y, { y: 0.19, z: 0.03 }));
        break;
      }
      case 'glasses': {
        const m = mat('#0ea5e9', { metalness: 0.6, roughness: 0.2 });
        [-1, 1].forEach((s) => h.add(mesh(new THREE.TorusGeometry(0.045, 0.01, 6, 16), m, { x: s * 0.06, y: 0.16, z: 0.165 })));
        h.add(mesh(new THREE.BoxGeometry(0.04, 0.01, 0.01), m, { y: 0.165, z: 0.17 }));
        break;
      }
      case 'lasereyes': {
        this.laser = new THREE.Group();
        [-1, 1].forEach((s) => {
          const beam = mesh(
            new THREE.CylinderGeometry(0.008, 0.008, 3, 6),
            new THREE.MeshBasicMaterial({ color: '#ff2020', transparent: true, opacity: 0.6 }),
            { x: s * 0.06, y: 0.16, z: 1.65, rx: Math.PI / 2 },
          );
          beam.castShadow = false;
          this.laser.add(beam);
        });
        this.laser.visible = false;
        h.add(this.laser);
        break;
      }
    }
  }

  setPose(pose) {
    this.pose = pose;
  }

  // ctx: { typing: 0..1 intensity, talking: bool, lookAt: Vector3|null (world), hype: bool }
  update(dt, ctx = {}) {
    this.phase += dt;
    const p = this.phase;
    const [legL, legR] = this.legs;
    const [armL, armR] = this.arms;
    const damp = (cur, target, k = 8) => cur + (target - cur) * Math.min(1, dt * k);

    let hipY = HIP_STAND;
    let thighL = 0, thighR = 0, kneeL = 0, kneeR = 0;
    let shL = 0, shR = 0, elL = 0, elR = 0;
    let torsoLean = 0;

    if (this.pose === 'sit') {
      hipY = HIP_SIT;
      thighL = thighR = -Math.PI / 2;
      kneeL = kneeR = Math.PI / 2 - 0.05;
      torsoLean = 0.08;
      const typing = ctx.typing ?? 0;
      if (typing > 0) {
        const speed = 10 + typing * 16;
        shL = -0.55 + Math.sin(p * speed) * 0.06 * typing;
        shR = -0.55 + Math.sin(p * speed + 1.7) * 0.06 * typing;
        elL = elR = -1.0;
      } else {
        shL = shR = -0.25;
        elL = elR = -0.9;
      }
    } else if (this.pose === 'walk') {
      const s = Math.sin(p * 7);
      thighL = s * 0.55;
      thighR = -s * 0.55;
      kneeL = Math.max(0, -Math.cos(p * 7)) * 0.7;
      kneeR = Math.max(0, Math.cos(p * 7)) * 0.7;
      shL = -s * 0.5;
      shR = s * 0.5;
      elL = elR = -0.3;
      hipY = HIP_STAND + Math.abs(Math.cos(p * 7)) * 0.04;
    } else {
      // standing idle: breathe, gesture while talking
      const t = ctx.talking ? 1 : 0;
      shL = -0.05 + Math.sin(p * 1.3) * 0.03 - t * (0.4 + Math.sin(p * 3.1) * 0.25);
      shR = -0.05 + Math.sin(p * 1.1) * 0.03 - t * (0.3 + Math.sin(p * 2.3 + 1) * 0.2);
      elL = -0.15 - t * 0.9;
      elR = -0.15 - t * 0.7;
      hipY = HIP_STAND + Math.sin(p * 1.6) * 0.005;
    }

    this.hips.position.y = damp(this.hips.position.y, hipY, 10);
    legL.upper.rotation.x = damp(legL.upper.rotation.x, thighL, 12);
    legR.upper.rotation.x = damp(legR.upper.rotation.x, thighR, 12);
    legL.joint.rotation.x = damp(legL.joint.rotation.x, kneeL, 12);
    legR.joint.rotation.x = damp(legR.joint.rotation.x, kneeR, 12);
    armL.upper.rotation.x = damp(armL.upper.rotation.x, shL, 14);
    armR.upper.rotation.x = damp(armR.upper.rotation.x, shR, 14);
    armL.joint.rotation.x = damp(armL.joint.rotation.x, elL, 14);
    armR.joint.rotation.x = damp(armR.joint.rotation.x, elR, 14);
    this.torso.rotation.x = damp(this.torso.rotation.x, torsoLean + Math.sin(p * 1.6) * 0.01, 6);

    // Head look-at (yaw/pitch relative to body), clamped so necks stay attached.
    let yaw = Math.sin(p * 0.4) * 0.15;
    let pitch = this.pose === 'sit' && (ctx.typing ?? 0) > 0 ? 0.12 : 0;
    if (ctx.lookAt) {
      const headWorld = this.head.getWorldPosition(new THREE.Vector3());
      const d = ctx.lookAt.clone().sub(headWorld);
      const local = d.applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()).invert());
      yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.1, 1.1);
      pitch = THREE.MathUtils.clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.5, 0.5);
    }
    this.headYaw = damp(this.headYaw, yaw, 6);
    this.headPitch = damp(this.headPitch, pitch, 6);
    this.head.rotation.set(this.headPitch, this.headYaw, 0);

    // Mouth flap while speaking
    this.talk = ctx.talking ? damp(this.talk, 0.5 + 0.5 * Math.abs(Math.sin(p * 14) * Math.sin(p * 5.3)), 20) : damp(this.talk, 0, 12);
    this.mouth.scale.y = 1 + this.talk * 3.5;

    // Blink
    this.blinkIn -= dt;
    const blinking = this.blinkIn < 0.12;
    if (this.blinkIn < 0) this.blinkIn = 2 + Math.random() * 4;
    this.eyes.forEach((e) => (e.scale.y = blinking ? 0.15 : 1));

    if (this.laser) this.laser.visible = Boolean(ctx.hype) && Math.sin(p * 20) > -0.3;
  }
}
