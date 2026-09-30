import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ArenaView, GameEvent } from '../sim/arena.ts';
import { bowlHeight, bowlMesh, rho, surfaceHeight } from '../sim/bowl.ts';
import { BUILDINGS, TREE, TREES, TUNNELS, TUNNEL, tunnelLocal, tunnelMesh, WALLS, type Box } from '../sim/city.ts';
import { SECTIONS, forward } from '../sim/rules.ts';
import type { TopLook } from '../net/protocol.ts';
import { ARENA, CAMERA, MECH } from '../tuning.ts';
import { applyKit, loadArena, lookColor, makeMech, makeTop, shadowGeometry } from './models.ts';

export interface Frame { view: ArenaView; shadows: Float32Array; events: GameEvent[] }
/** Who is looking: the camera follows this player, and their own character is never hidden from them. */
export interface Viewer { team: 'mech' | 'top' | 'watch'; top: number; looks: TopLook[]; names: string[]; mechName: string }

interface Pulse { mesh: THREE.Mesh; age: number; life: number; grow: number }
interface Fader { materials: THREE.Material[]; opacity: number }

const PITCH = Math.atan2(CAMERA.height, CAMERA.back);
/** How far toward −Z (away from the camera) a tree canopy appears on screen, relative to its trunk. */
const CANOPY_SHIFT = TREE.canopyHeight / Math.tan(PITCH);

/** True when a player at (x, z) is hidden from the camera by a tunnel roof or a tree canopy. */
export function hidden(x: number, z: number): boolean { return tunnelAt(x, z) >= 0 || treesHiding(x, z).length > 0; }
function tunnelAt(x: number, z: number): number {
  return TUNNELS.findIndex(t => { const { u, v } = tunnelLocal(t, x, z); return Math.abs(u) <= TUNNEL.length / 2 - 0.3 && Math.abs(v) <= 1.9; });
}
function treesHiding(x: number, z: number): number[] {
  const out: number[] = [];
  TREES.forEach((t, i) => { if (Math.hypot(x - t.x, z + 0.5 - (t.z - CANOPY_SHIFT)) < TREE.canopy * 0.9) out.push(i); });
  return out;
}

/** True when a building stands between the camera and a player at (x, z). */
function buildingCovers(b: Box, x: number, z: number): boolean {
  // Buildings are not rotated. The camera looks toward −Z, so a building hides what is just behind it.
  const reach = (b.top - surfaceHeight(b.x, b.z) + 1) / Math.tan(PITCH);
  return Math.abs(x - b.x) < b.hx + 0.8 && z < b.z + b.hz + 0.8 && z > b.z - b.hz - reach;
}

export class Scene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly scene = new THREE.Scene();
  private tops: THREE.Object3D[] = [];
  private topKey = '';
  private mech: THREE.Object3D | null = null;
  private mechKit = '';
  private mechParts: { legL?: THREE.Object3D; legR?: THREE.Object3D; plates: Record<string, THREE.Object3D[]>; flames: THREE.Mesh[] } = { plates: {}, flames: [] };
  private mechGlow = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  private walk = 0;
  private lastMech = new THREE.Vector2();
  private shadowMesh: THREE.InstancedMesh | null = null;
  private shadowGeo: THREE.BufferGeometry | null = null;
  private shadowMat = new THREE.MeshStandardMaterial({ color: 0x241036, emissive: 0x6a2cff, emissiveIntensity: 0.55, transparent: true, opacity: 0.72, roughness: 0.5 });
  private pulses: Pulse[] = [];
  private selfRing: THREE.Mesh;
  private shieldArc: THREE.Mesh;
  private hoverRing: THREE.Mesh;
  private flash = 0;
  private tmp = new THREE.Object3D();
  private shake = 0;
  private focus = new THREE.Vector3();
  private roofs: Fader[] = [];
  private canopies: Fader[] = [];
  private blocks: Fader[] = [];
  private tags = new Map<string, HTMLElement>();
  private tagLayer: HTMLElement;
  private sun: THREE.DirectionalLight;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 250);
    this.scene.background = new THREE.Color(0x0d1220);
    // Soft reflections, so the metal parts of the Blender models read as metal.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    this.scene.fog = new THREE.Fog(0x0d1220, 50, 110);

    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2233, 1.1));
    // The sun's shadow box follows the camera, so shadows stay sharp on the large map.
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera as THREE.OrthographicCamera;
    c.left = -30; c.right = 30; c.bottom = -24; c.top = 24; c.near = 5; c.far = 90;
    this.scene.add(this.sun, this.sun.target);

    const flat = (geo: THREE.BufferGeometry, color: number, opacity: number) => {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2; mesh.visible = false; this.scene.add(mesh); return mesh;
    };
    this.selfRing = flat(new THREE.RingGeometry(1, 1.25, 40), 0xffffff, 0.75);
    this.hoverRing = flat(new THREE.RingGeometry(1.4, 2.2, 40), 0x7fd8ff, 0.35);
    const arc = (MECH.shieldArc * Math.PI) / 180;
    this.shieldArc = new THREE.Mesh(new THREE.CylinderGeometry(MECH.radius + 0.5, MECH.radius + 0.5, 2.6, 24, 1, true, -arc / 2, arc),
      new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    this.shieldArc.visible = false;
    this.scene.add(this.shieldArc);

    this.tagLayer = document.createElement('div');
    this.tagLayer.id = 'tags';
    document.body.append(this.tagLayer);

    void this.buildArena();
    void shadowGeometry().then(g => { this.shadowGeo = g; });
    void makeMech().then(m => this.setMech(m));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ---------- Arena ----------

  private async buildArena(): Promise<void> {
    const glb = await loadArena();
    const root = glb ?? this.fallbackArena();
    this.scene.add(root);
    // Tunnel roofs, tree canopies and buildings fade for the player they hide; each needs its own materials.
    // GLTFLoader turns spaces in node names into underscores, so the patterns accept both.
    const faders = (pattern: RegExp, out: Fader[]) => root.traverse(o => {
      const m = pattern.exec(o.name);
      if (!m) return;
      const fader: Fader = out[Number(m[1])] ??= { materials: [], opacity: 1 };
      o.traverse(c => {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh) return;
        const list = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(mt => { const copy = mt.clone(); copy.transparent = true; return copy; });
        mesh.material = Array.isArray(mesh.material) ? list : list[0]!;
        fader.materials.push(...list);
      });
    });
    faders(/^Tunnel[ _]Roof[ _](\d+)$/, this.roofs);
    faders(/^Tree[ _]Canopy[ _](\d+)$/, this.canopies);
    faders(/^Block[ _](\d+)$/, this.blocks);
  }

  /** The built-in city, used when arena.glb is missing. */
  private fallbackArena(): THREE.Group {
    const root = new THREE.Group();
    const data = bowlMesh(48, 128);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeVertexNormals();
    const colors = new Float32Array(data.vertices.length);
    for (let i = 0; i < data.vertices.length; i += 3) {
      const r = rho(data.vertices[i]!, data.vertices[i + 2]!);
      const c = new THREE.Color(r > ARENA.floorRadius ? 0x39465e : Math.floor(r / 4) % 2 ? 0x27324a : 0x2d3a55);
      colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const bowl = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide }));
    bowl.receiveShadow = true;
    root.add(bowl);
    const boxMesh = (b: Box, color: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2), new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5 }));
      mesh.position.set(b.x, b.y, b.z); mesh.rotation.y = -b.angle; mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    };
    for (const w of WALLS) boxMesh(w, 0x8b98b0);
    BUILDINGS.forEach((b, i) => { boxMesh(b, 0x4a5670); root.children[root.children.length - 1]!.name = `Block ${i}`; });
    TUNNELS.forEach((t, i) => {
      const d = tunnelMesh(t);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(d.vertices, 3));
      g.setIndex(new THREE.BufferAttribute(d.indices, 1));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9aa6bd, roughness: 0.6, side: THREE.DoubleSide }));
      mesh.name = `Tunnel Roof ${i}`; mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    });
    TREES.forEach((t, i) => {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(TREE.trunk * 0.8, TREE.trunk, TREE.trunkHeight + 1, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2e }));
      trunk.position.set(t.x, t.base + (TREE.trunkHeight + 1) / 2, t.z); trunk.castShadow = true;
      const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(TREE.canopy, 1), new THREE.MeshStandardMaterial({ color: 0x3f9a55, roughness: 0.8, flatShading: true }));
      canopy.position.set(t.x, t.base + TREE.canopyHeight, t.z); canopy.name = `Tree Canopy ${i}`; canopy.castShadow = true;
      root.add(trunk, canopy);
    });
    return root;
  }

  // ---------- Characters ----------

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
    this.mechKit = '';
  }

  private setTops(looks: TopLook[]): void {
    const key = JSON.stringify(looks);
    if (key === this.topKey) return;
    this.topKey = key;
    for (const t of this.tops) this.scene.remove(t);
    this.tops = [];
    looks.forEach((look, i) => void makeTop(look).then(o => { if (this.topKey === key) { this.tops[i] = o; this.scene.add(o); } }));
  }

  // ---------- Camera and input ----------

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Narrow windows see less across, so widen the view a little.
    this.camera.fov = w / h < 1.2 ? 45 * (1.2 / (w / h)) ** 0.6 : 45;
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
      y = bowlHeight(Math.min(rho(x, z), ARENA.rimRadius));
    }
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }

  /** The point the camera follows: your own top or mech; watchers follow the mech. */
  private target(view: ArenaView | null, viewer: Viewer): THREE.Vector3 | null {
    if (!view) return null;
    const t = viewer.team === 'top' ? view.tops[viewer.top] : null;
    const p = t ?? view.mech;
    return new THREE.Vector3(p.x, surfaceHeight(p.x, p.z), p.z);
  }

  render(frame: Frame | null, viewer: Viewer, dt: number): void {
    const goal = this.target(frame?.view ?? null, viewer) ?? new THREE.Vector3(0, 0, 0);
    this.focus.lerp(goal, 1 - Math.exp(-CAMERA.follow * dt));
    if (this.focus.distanceTo(goal) > 25) this.focus.copy(goal); // jump straight to a new round
    if (frame) this.apply(frame, viewer, dt);
    this.pulses = this.pulses.filter(p => {
      p.age += dt;
      const k = p.age / p.life;
      p.mesh.scale.setScalar(1 + p.grow * k);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      if (k >= 1) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); }
      return k < 1;
    });
    this.shake = Math.max(0, this.shake - dt * 3);
    const f = this.focus;
    this.camera.position.set(f.x + (Math.random() - 0.5) * this.shake, f.y + CAMERA.height + (Math.random() - 0.5) * this.shake, f.z + CAMERA.back);
    this.camera.lookAt(f.x, f.y, f.z);
    this.sun.position.set(f.x + 12, f.y + 30, f.z + 10);
    this.sun.target.position.copy(f);
    this.renderer.render(this.scene, this.camera);
    if (frame) this.updateTags(frame.view, viewer);
    else this.tagLayer.replaceChildren();
  }

  private apply(frame: Frame, viewer: Viewer, dt: number): void {
    const { view } = frame;
    this.setTops(viewer.looks.slice(0, view.tops.length));
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
      const kitKey = JSON.stringify(m.kit);
      if (kitKey !== this.mechKit) { applyKit(this.mech, m.kit); this.mechKit = kitKey; }
      this.mech.position.set(m.x, m.y - MECH.height / 2, m.z);
      this.mech.rotation.y = m.yaw;
      const moved = Math.hypot(m.x - this.lastMech.x, m.z - this.lastMech.y);
      this.lastMech.set(m.x, m.z);
      if (!m.air) this.walk += moved * 1.6;
      const tuck = m.air || m.hover;
      const swing = tuck ? 0.5 : Math.sin(this.walk) * Math.min(0.6, moved * 20);
      if (this.mechParts.legL) this.mechParts.legL.rotation.x = swing;
      if (this.mechParts.legR) this.mechParts.legR.rotation.x = tuck ? 0.5 : -swing;
      for (const s of SECTIONS) this.mechParts.plates[s]?.forEach((p, i) => { p.visible = i >= m.hits[s]; });
      for (const f of this.mechParts.flames) { f.visible = m.air || m.boost; f.scale.y = 0.8 + Math.random() * 0.5; }
      this.flash = Math.max(0, this.flash - dt * 4);
      for (const [mat, glow] of this.mechGlow) mat.emissive.setRGB(glow.r + this.flash, glow.g + this.flash * 0.3, glow.b + this.flash * 0.2);
    }
    this.shieldArc.visible = m.shield;
    if (m.shield) { this.shieldArc.position.set(m.x, m.y, m.z); this.shieldArc.rotation.y = m.yaw; }
    this.hoverRing.visible = m.hover;
    if (m.hover) { this.hoverRing.position.set(m.x, surfaceHeight(m.x, m.z) + 0.08, m.z); this.hoverRing.scale.setScalar(0.9 + Math.random() * 0.2); }
    this.updateShadows(frame.shadows);
    this.updateSelf(view, viewer, dt);
    let born = 0;
    for (const e of frame.events) if (e.k === 'shadow') born++;
    for (let i = frame.shadows.length / 3 - born; i < frame.shadows.length / 3; i++) this.ring(frame.shadows[i * 3]!, frame.shadows[i * 3 + 2]!, 0.9, 0x9a5cff, 0.6, 2.5);
    for (const e of frame.events) this.effect(e, view, viewer);
  }

  /** Your ring, and see-through roofs and canopies over your own character. */
  private updateSelf(view: ArenaView, viewer: Viewer, dt: number): void {
    const m = view.mech, t = viewer.team === 'top' ? view.tops[viewer.top] : null;
    const me = t ?? (viewer.team === 'mech' ? m : null);
    this.selfRing.visible = !!me;
    if (me) {
      this.selfRing.scale.setScalar(t ? 0.8 : 1.6);
      this.selfRing.position.set(me.x, surfaceHeight(me.x, me.z) + 0.05, me.z);
      (this.selfRing.material as THREE.MeshBasicMaterial).color.setHex(t ? lookColor(viewer.looks[viewer.top] ?? { top: 0, mid: 0, bot: 0 }) : 0xffffff);
    }
    const roof = me ? tunnelAt(me.x, me.z) : -1;
    const canopies = me ? treesHiding(me.x, me.z) : [];
    this.roofs.forEach((f, i) => this.fade(f, i === roof ? 0.25 : 1, dt));
    this.canopies.forEach((f, i) => this.fade(f, canopies.includes(i) ? 0.3 : 1, dt));
    this.blocks.forEach((f, i) => this.fade(f, me && buildingCovers(BUILDINGS[i]!, me.x, me.z) ? 0.25 : 1, dt));
  }

  /** Moves a fader toward its target opacity in about a quarter of a second. */
  private fade(f: Fader, target: number, dt: number): void {
    if (Math.abs(f.opacity - target) < 0.01) return;
    f.opacity += (target - f.opacity) * (1 - Math.exp(-12 * dt));
    for (const m of f.materials) { m.opacity = f.opacity; m.depthWrite = f.opacity > 0.95; }
  }

  /** Name tags above players. Another player's tag disappears while a roof or tree hides them. */
  private updateTags(view: ArenaView, viewer: Viewer): void {
    const seen = new Set<string>();
    const place = (key: string, text: string, x: number, y: number, z: number, color: string, mine: boolean) => {
      if (!mine && hidden(x, z)) return;
      const p = new THREE.Vector3(x, y, z).project(this.camera);
      if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) return;
      let el = this.tags.get(key);
      if (!el) { el = document.createElement('div'); el.className = 'tag'; this.tags.set(key, el); }
      el.textContent = text;
      el.style.color = color;
      el.style.transform = `translate(${((p.x + 1) / 2) * window.innerWidth}px, ${((1 - p.y) / 2) * window.innerHeight}px) translate(-50%, -100%)`;
      seen.add(key);
      if (el.parentElement !== this.tagLayer) this.tagLayer.append(el);
    };
    view.tops.forEach((t, i) => {
      const color = `#${lookColor(viewer.looks[i] ?? { top: 0, mid: 0, bot: 0 }).toString(16).padStart(6, '0')}`;
      place(`t${i}`, viewer.names[i] ?? 'Top', t.x, t.y + 1.1, t.z, color, viewer.team === 'top' && viewer.top === i);
    });
    place('mech', viewer.mechName, view.mech.x, view.mech.y + 2.3, view.mech.z, '#ffd2a8', viewer.team === 'mech');
    for (const [key, el] of this.tags) if (!seen.has(key)) el.remove();
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
    mesh.position.set(x, surfaceHeight(x, z) + 0.1, z);
    this.scene.add(mesh);
    this.pulses.push({ mesh, age: 0, life, grow });
  }

  private effect(e: GameEvent, view: ArenaView, viewer: Viewer): void {
    const m = view.mech;
    switch (e.k) {
      case 'hit': this.flash = 1; this.shake = 0.8; this.ring(e.x, e.z, 1, 0xff5040, 0.4, 2); break;
      case 'block': this.ring(e.x, e.z, 1, 0x7fe3ff, 0.35, 2); break;
      case 'pop': this.ring(e.x, e.z, 0.7, 0xd9b8ff, 0.4, 2.5); break;
      case 'shadowHit': this.ring(e.x, e.z, 0.8, 0x9a5cff, 0.35, 1.5); if (e.pushed) this.shake = 0.4; break;
      case 'parry': this.ring(m.x, m.z, e.radius + MECH.radius, 0x7fe3ff, 0.45, 0.15); this.ring(m.x, m.z, 1, 0xffffff, 0.35, e.radius); break;
      case 'shield': { const [fx, fz] = forward(m.yaw); this.ring(m.x + fx * 2, m.z + fz * 2, 1.2, 0x7fe3ff, 0.3, 1); break; }
      case 'blink': this.ring(e.fx, e.fz, 1.6, 0xb58cff, 0.5, 1.2); this.ring(e.tx, e.tz, 1.6, 0xb58cff, 0.5, -0.4); break;
      case 'land': this.ring(m.x, m.z, 1.5, 0xffd27f, 0.4, 1.5); this.shake = 0.3; break;
      case 'dash': { const t = view.tops[e.top]; if (t) this.ring(t.x, t.z, 0.8, lookColor(viewer.looks[e.top] ?? { top: 0, mid: 0, bot: 0 }), 0.3, 1.5); break; }
      default: break;
    }
  }
}

