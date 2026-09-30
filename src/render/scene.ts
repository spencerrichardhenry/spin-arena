import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ArenaView, GameEvent } from '../sim/arena.ts';
import { bowlHeight, bowlMesh } from '../sim/bowl.ts';
import { SECTIONS } from '../sim/rules.ts';
import { ARENA, MECH } from '../tuning.ts';
import { loadArena, makeMech, makeTop, shadowGeometry, TOP_COLORS } from './models.ts';

export interface Frame { view: ArenaView; shadows: Float32Array; events: GameEvent[] }

interface Pulse { mesh: THREE.Mesh; age: number; life: number; grow: number }

export class Scene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private tops: THREE.Object3D[] = [];
  private topPromises: Promise<THREE.Object3D>[] = [];
  private mech: THREE.Object3D | null = null;
  private mechParts: { legL?: THREE.Object3D; legR?: THREE.Object3D; plates: Record<string, THREE.Object3D[]>; flames: THREE.Mesh[] } = { plates: {}, flames: [] };
  private mechGlow = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  private walk = 0;
  private lastMech = new THREE.Vector2();
  private shadowMesh: THREE.InstancedMesh | null = null;
  private shadowGeo: THREE.BufferGeometry | null = null;
  private shadowMat = new THREE.MeshStandardMaterial({ color: 0x241036, emissive: 0x6a2cff, emissiveIntensity: 0.55, transparent: true, opacity: 0.72, roughness: 0.5 });
  private pulses: Pulse[] = [];
  private selfRing: THREE.Mesh;
  private flash = 0;
  private tmp = new THREE.Object3D();
  private shake = 0;
  private topCount = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 200);
    this.camera.position.set(0, 31, 24);
    this.camera.lookAt(0, 0, 1.5);
    this.scene.background = new THREE.Color(0x0d1220);
    // Soft reflections, so the metal parts of the Blender models read as metal.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    this.scene.fog = new THREE.Fog(0x0d1220, 60, 110);

    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2233, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(12, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera as THREE.OrthographicCamera;
    c.left = c.bottom = -22; c.right = c.top = 22; c.near = 5; c.far = 70;
    this.scene.add(sun);

    const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.25, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    this.selfRing = ring;
    this.scene.add(ring);

    this.buildArena();
    void shadowGeometry().then(g => { this.shadowGeo = g; });
    void makeMech().then(m => this.setMech(m));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private async buildArena(): Promise<void> {
    const glb = await loadArena();
    if (glb) { this.scene.add(glb); return; }
    const data = bowlMesh(40, 96);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeVertexNormals();
    // Colour bands so the slope reads from above.
    const colors = new Float32Array(data.vertices.length);
    for (let i = 0; i < data.vertices.length; i += 3) {
      const r = Math.hypot(data.vertices[i]!, data.vertices[i + 2]!);
      const c = new THREE.Color(r > ARENA.floorRadius ? 0x39465e : Math.floor(r / 3) % 2 ? 0x27324a : 0x2d3a55);
      colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const bowl = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide }));
    bowl.receiveShadow = true;
    this.scene.add(bowl);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(ARENA.rimRadius, 0.35, 12, 96), new THREE.MeshStandardMaterial({ color: 0xe0e6f0, metalness: 0.7, roughness: 0.3 }));
    lip.rotation.x = Math.PI / 2; lip.position.y = ARENA.rimHeight;
    this.scene.add(lip);
    const centre = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), new THREE.MeshStandardMaterial({ color: 0xff8a3d, emissive: 0x8a3000, roughness: 0.4 }));
    centre.rotation.x = -Math.PI / 2; centre.position.y = 0.02;
    this.scene.add(centre);
  }

  private setMech(m: THREE.Object3D): void {
    this.mech = m;
    this.scene.add(m);
    m.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Own material copies, so the hit flash does not change other objects that share them.
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mesh.material = mat;
      if (mat.emissive) this.mechGlow.set(mat, mat.emissive.clone());
    });
    this.mechParts.legL = m.getObjectByName('legL');
    this.mechParts.legR = m.getObjectByName('legR');
    for (const s of SECTIONS) this.mechParts.plates[s] = [1, 2, 3].map(i => m.getObjectByName(`plate_${s}_${i}`)).filter((o): o is THREE.Object3D => !!o);
    const thrusters = m.getObjectByName('thrusters');
    if (thrusters) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.85 });
      for (const x of [0.5, -0.5]) {
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.1, 10), mat);
        flame.rotation.x = Math.PI; flame.position.set(x, -0.9, 0); flame.visible = false;
        thrusters.add(flame); this.mechParts.flames.push(flame);
      }
    }
  }

  /** Creates top objects for a round. */
  setTopCount(count: number): void {
    if (count === this.topCount) return;
    for (const t of this.tops) this.scene.remove(t);
    this.tops = [];
    this.topCount = count;
    this.topPromises = Array.from({ length: count }, (_, i) => makeTop(i));
    this.topPromises.forEach((p, i) => void p.then(o => { if (this.topCount === count) { this.tops[i] = o; this.scene.add(o); } }));
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole bowl in view on narrow windows.
    this.camera.fov = w / h < 1.2 ? 42 * (1.2 / (w / h)) ** 0.7 : 42;
    this.camera.updateProjectionMatrix();
  }

  /** Mouse position to a point on the bowl. */
  pick(clientX: number, clientY: number): { x: number; z: number } {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let y = 0, t = 0;
    for (let i = 0; i < 6; i++) {
      t = (y - o.y) / d.y;
      const x = o.x + d.x * t, z = o.z + d.z * t;
      y = bowlHeight(Math.min(Math.hypot(x, z), ARENA.rimRadius));
    }
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }

  render(frame: Frame | null, self: { team: 'mech' | 'top' | 'watch'; top: number }, dt: number): void {
    if (frame) this.apply(frame, self, dt);
    this.pulses = this.pulses.filter(p => {
      p.age += dt;
      const k = p.age / p.life;
      p.mesh.scale.setScalar(1 + p.grow * k);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      if (k >= 1) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); }
      return k < 1;
    });
    this.shake = Math.max(0, this.shake - dt * 3);
    this.camera.position.set((Math.random() - 0.5) * this.shake, 31 + (Math.random() - 0.5) * this.shake, 24);
    this.camera.lookAt(0, 0, 1.5);
    this.renderer.render(this.scene, this.camera);
  }

  private apply(frame: Frame, self: { team: string; top: number }, dt: number): void {
    const { view } = frame;
    this.setTopCount(view.tops.length);
    view.tops.forEach((t, i) => {
      const o = this.tops[i];
      if (!o) return;
      o.position.set(t.x, t.y - 0.6, t.z);
      const spin = o.getObjectByName('spin');
      if (spin) spin.rotation.y = t.spin;
      o.rotation.z = t.dashing ? Math.sin(t.spin * 0.5) * 0.08 : 0;
    });
    const m = view.mech;
    if (this.mech) {
      this.mech.position.set(m.x, m.y - MECH.height / 2, m.z);
      this.mech.rotation.y = m.yaw;
      const moved = Math.hypot(m.x - this.lastMech.x, m.z - this.lastMech.y);
      this.lastMech.set(m.x, m.z);
      if (!m.air) this.walk += moved * 1.6;
      const swing = m.air ? 0.5 : Math.sin(this.walk) * Math.min(0.6, moved * 20);
      if (this.mechParts.legL) this.mechParts.legL.rotation.x = swing;
      if (this.mechParts.legR) this.mechParts.legR.rotation.x = m.air ? 0.5 : -swing;
      for (const s of SECTIONS) this.mechParts.plates[s]?.forEach((p, i) => { p.visible = i >= m.hits[s]; });
      for (const f of this.mechParts.flames) { f.visible = m.air || m.boost; f.scale.y = 0.8 + Math.random() * 0.5; }
      this.flash = Math.max(0, this.flash - dt * 4);
      for (const [mat, glow] of this.mechGlow) mat.emissive.setRGB(glow.r + this.flash, glow.g + this.flash * 0.3, glow.b + this.flash * 0.2);
    }
    this.updateShadows(frame.shadows);
    if (self.team === 'mech' && this.mech) { this.selfRing.visible = true; this.selfRing.scale.setScalar(1.6); this.selfRing.position.set(m.x, bowlHeight(Math.hypot(m.x, m.z)) + 0.05, m.z); }
    else if (self.team === 'top' && view.tops[self.top]) {
      const t = view.tops[self.top]!;
      this.selfRing.visible = true; this.selfRing.scale.setScalar(0.8);
      this.selfRing.position.set(t.x, bowlHeight(Math.hypot(t.x, t.z)) + 0.05, t.z);
      (this.selfRing.material as THREE.MeshBasicMaterial).color.setHex(TOP_COLORS[self.top % 4]!);
    } else this.selfRing.visible = false;
    let born = 0;
    for (const e of frame.events) if (e.k === 'shadow') born++;
    for (let i = frame.shadows.length / 3 - born; i < frame.shadows.length / 3; i++) this.ring(frame.shadows[i * 3]!, frame.shadows[i * 3 + 2]!, 0.9, 0x9a5cff, 0.6, 2.5);
    for (const e of frame.events) this.effect(e, view);
  }

  private updateShadows(positions: Float32Array): void {
    const count = positions.length / 3;
    if (!this.shadowGeo) return;
    if (!this.shadowMesh || this.shadowMesh.instanceMatrix.count < count) {
      if (this.shadowMesh) this.scene.remove(this.shadowMesh);
      const capacity = Math.max(64, 2 ** Math.ceil(Math.log2(count + 1)));
      this.shadowMesh = new THREE.InstancedMesh(this.shadowGeo, this.shadowMat, capacity);
      this.shadowMesh.frustumCulled = false;
      this.scene.add(this.shadowMesh);
    }
    const spin = performance.now() / 1000 * 30;
    for (let i = 0; i < count; i++) {
      this.tmp.position.set(positions[i * 3]!, positions[i * 3 + 1]! - 0.6, positions[i * 3 + 2]!);
      this.tmp.rotation.set(0, spin + i, 0);
      this.tmp.updateMatrix();
      this.shadowMesh.setMatrixAt(i, this.tmp.matrix);
    }
    this.shadowMesh.count = count;
    this.shadowMesh.instanceMatrix.needsUpdate = true;
  }

  private ring(x: number, z: number, radius: number, color: number, life: number, grow: number): void {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(radius * 0.85, radius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, bowlHeight(Math.hypot(x, z)) + 0.1, z);
    this.scene.add(mesh);
    this.pulses.push({ mesh, age: 0, life, grow });
  }

  private effect(e: GameEvent, view: ArenaView): void {
    const m = view.mech;
    switch (e.k) {
      case 'hit': this.flash = 1; this.shake = 0.8; this.ring(e.x, e.z, 1, 0xff5040, 0.4, 2); break;
      case 'shadowHit': this.ring(e.x, e.z, 0.8, 0x9a5cff, 0.35, 1.5); if (e.pushed) this.shake = 0.4; break;
      case 'parry': this.ring(m.x, m.z, e.radius + MECH.radius, 0x7fe3ff, 0.45, 0.15); this.ring(m.x, m.z, 1, 0xffffff, 0.35, e.radius); break;
      case 'land': this.ring(m.x, m.z, 1.5, 0xffd27f, 0.4, 1.5); this.shake = 0.3; break;
      case 'dash': { const t = view.tops[e.top]; if (t) this.ring(t.x, t.z, 0.8, TOP_COLORS[e.top % 4]!, 0.3, 1.5); break; }
      default: break;
    }
  }
}
