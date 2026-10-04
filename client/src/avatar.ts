// Stylized survivor: chunky proportions, big head, bright jacket.
// Bright characters against a grey world is the game's art rule.

import * as THREE from 'three';

// Clean, slightly glossy materials: the characters stay bright and stylized like Fortnite,
// while still picking up the world's sunlight and sky reflections.
function toon(color: number, roughness = 0.6) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

export class Avatar {
  readonly root = new THREE.Group();
  private legL: THREE.Object3D;
  private legR: THREE.Object3D;
  private armL: THREE.Object3D;
  private armR: THREE.Object3D;
  private body: THREE.Object3D;
  private phase = 0;
  private swingTimer = 0;

  constructor(color: number, name?: string) {
    const jacket = toon(color);
    const pants = toon(0x2b2f3a, 0.85);
    const skin = toon(0xf2c29b);
    const boots = toon(0x3b2a20, 0.9);
    const pack = toon(0x8a6a3c, 0.85);

    const body = new THREE.Group();
    this.body = body;
    this.root.add(body);

    const leg = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.78, 0);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.24), pants);
      thigh.position.y = -0.33;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.34), boots);
      boot.position.set(0, -0.7, 0.04);
      pivot.add(thigh, boot);
      body.add(pivot);
      return pivot;
    };
    this.legL = leg(-0.13);
    this.legR = leg(0.13);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.32, 4, 10), jacket);
    torso.position.y = 1.08;
    torso.scale.set(1, 1, 0.8);
    body.add(torso);

    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.18), pack);
    backpack.position.set(0, 1.1, -0.27);
    body.add(backpack);

    const arm = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.3, 0);
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.38, 4, 8), jacket);
      sleeve.position.y = -0.26;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), skin);
      hand.position.y = -0.52;
      pivot.add(sleeve, hand);
      body.add(pivot);
      return pivot;
    };
    this.armL = arm(-0.36);
    this.armR = arm(0.36);

    // Oversized head for the stylized look.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), skin);
    head.position.y = 1.58;
    body.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.265, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x3a2418));
    hair.position.y = 1.62;
    hair.rotation.x = -0.25;
    body.add(hair);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    for (const x of [-0.09, 0.09]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeMat);
      eye.position.set(x, 1.6, 0.225);
      body.add(eye);
    }
    // Goggles strap: a wasteland touch.
    const goggles = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.03, 6, 20), toon(0x222222));
    goggles.rotation.x = Math.PI / 2;
    goggles.position.y = 1.72;
    body.add(goggles);

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });

    if (name) {
      const tag = nameTag(name, color);
      tag.position.y = 2.15;
      this.root.add(tag);
    }
  }

  /** Plays a quick arm swing, used when gathering or building. */
  swing() {
    this.swingTimer = 0.3;
  }

  update(dt: number, moving: boolean) {
    const target = moving ? 1 : 0;
    this.phase += dt * 9 * target;
    const s = Math.sin(this.phase) * 0.7 * target;
    this.legL.rotation.x = s;
    this.legR.rotation.x = -s;
    this.armL.rotation.x = -s * 0.8;
    this.armR.rotation.x = s * 0.8;
    this.body.position.y = moving ? Math.abs(Math.cos(this.phase)) * 0.05 : 0;
    if (this.swingTimer > 0) {
      this.swingTimer -= dt;
      this.armR.rotation.x = -2.2 * Math.sin((this.swingTimer / 0.3) * Math.PI);
    }
  }
}

function nameTag(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 30px system-ui, sans-serif';
  const w = Math.min(ctx.measureText(text).width + 28, 256);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect((256 - w) / 2, 10, w, 44, 12);
  ctx.fill();
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthWrite: false }));
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}
