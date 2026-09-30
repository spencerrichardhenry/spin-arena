import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MECH, TOP } from '../tuning.ts';
import { SECTIONS, type MechKit } from '../sim/rules.ts';
import type { TopLook } from '../net/protocol.ts';

/**
 * Model contract (shared with scripts/blender): +Z forward, +Y up, metres.
 * Top `top_<i>.glb` (design i): nodes `cap_<i>`, `ring_<i>` and `tip_<i>` are the three swappable parts;
 * the game puts the chosen three in a `spin` group that turns about Y. The tip touches y = 0.
 * Mech `mech.glb`: origin at the feet; `legL` (+X side), `legR` (−X side), `arms`, `thrusters` (flames attach
 * here), 12 plates `plate_<section>_<1..3>` and six kit groups `kit_<boost|blink|jump|hover|parry|shield>`.
 */

export const TOP_COLORS = [0xff5a4f, 0x3fa9ff, 0x52e07a, 0xffc93f];
export const DESIGN_NAMES = ['Blaze', 'Tidal', 'Gale', 'Quake'];
export const PART_NAMES = { top: 'Cap', mid: 'Ring', bot: 'Tip' } as const;
const PART_NODES = { top: 'cap', mid: 'ring', bot: 'tip' } as const;
/** The colour that identifies a top: its attack ring's paint. */
export function lookColor(look: TopLook): number { return TOP_COLORS[look.mid % TOP_COLORS.length]!; }

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group | null>>();

function load(name: string): Promise<THREE.Group | null> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`).then(g => g.scene as THREE.Group).catch(() => {
      console.warn(`[models] ${name}.glb is not available; using the built-in shape.`);
      return null;
    });
    cache.set(name, p);
  }
  return p;
}
function prepare(obj: THREE.Object3D): void {
  obj.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
}

// ---------- Tops ----------

function fallbackPart(part: keyof typeof PART_NODES, color: number): THREE.Object3D {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xc9d2dc, metalness: 0.8, roughness: 0.3 });
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.4 });
  if (part === 'bot') {
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.35, 16), metal); tip.rotation.x = Math.PI; tip.position.y = 0.18; g.add(tip);
  } else if (part === 'mid') {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.5, 0.22, 12), paint); ring.position.y = 0.45; g.add(ring);
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.18), metal);
      const a = (i / 3) * Math.PI * 2; blade.position.set(Math.cos(a) * 0.52, 0.45, Math.sin(a) * 0.52); blade.rotation.y = -a + 0.5; g.add(blade);
    }
  } else {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.18, 16), paint); cap.position.y = 0.64; g.add(cap);
  }
  return g;
}

/** A top built from three chosen parts. */
export async function makeTop(look: TopLook): Promise<THREE.Object3D> {
  const root = new THREE.Group();
  const spin = new THREE.Group(); spin.name = 'spin'; root.add(spin);
  for (const part of ['top', 'mid', 'bot'] as const) {
    const design = look[part];
    const glb = await load(`top_${design}`);
    const node = glb?.getObjectByName(`${PART_NODES[part]}_${design}`);
    spin.add(node ? node.clone(true) : fallbackPart(part, TOP_COLORS[design]!));
  }
  prepare(root);
  return root;
}

/** One merged geometry of a top, for the instanced shadow mesh. */
export async function shadowGeometry(): Promise<THREE.BufferGeometry> {
  const src = await makeTop({ top: 0, mid: 0, bot: 0 });
  src.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  src.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    parts.push(g.index ? g.toNonIndexed() : g);
  });
  return mergeGeometries(parts) ?? new THREE.CylinderGeometry(TOP.radius, TOP.radius * 0.6, 0.6, 12);
}

// ---------- Mech ----------

function fallbackMech(): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x59636e, metalness: 0.6, roughness: 0.45 });
  const plate = new THREE.MeshStandardMaterial({ color: 0xe8792b, metalness: 0.4, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23282e, metalness: 0.5, roughness: 0.6 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x9a6cff, emissive: 0x6a3cff });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, name = '') => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); mesh.name = name; parent.add(mesh); return mesh;
  };
  const group = (name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0) => { const o = new THREE.Group(); o.name = name; o.position.set(x, y, z); parent.add(o); return o; };
  for (const [name, x] of [['legL', 0.75], ['legR', -0.75]] as const) {
    const leg = group(name, g, x, 1.3, 0);
    box(0.45, 1.2, 0.5, dark, 0, -0.65, 0, leg); box(0.6, 0.15, 0.85, hull, 0, -1.22, 0.1, leg);
  }
  const body = group('body', g);
  box(1.9, 1.1, 1.6, hull, 0, 1.9, 0, body);
  box(0.9, 0.45, 0.7, dark, 0, 2.65, 0.25, body, 'cockpit');
  const arms = group('arms', body, 0, 2, 0);
  box(0.4, 0.4, 1.3, dark, 1.2, 0, 0.4, arms); box(0.4, 0.4, 1.3, dark, -1.2, 0, 0.4, arms);
  const thrusters = group('thrusters', group('kit_jump', body), 0, 1.9, -0.9);
  box(0.4, 0.8, 0.4, dark, 0.5, 0, 0, thrusters); box(0.4, 0.8, 0.4, dark, -0.5, 0, 0, thrusters);
  const hover = group('kit_hover', body);
  box(0.8, 0.2, 0.8, dark, 0.6, 2.2, -1, hover); box(0.8, 0.2, 0.8, dark, -0.6, 2.2, -1, hover);
  const boost = group('kit_boost', body);
  box(0.25, 0.25, 0.6, dark, 1.05, 1.5, -0.3, boost); box(0.25, 0.25, 0.6, dark, -1.05, 1.5, -0.3, boost);
  const blink = group('kit_blink', body);
  box(0.2, 0.6, 0.2, glow, 1.05, 1.5, -0.3, blink); box(0.2, 0.6, 0.2, glow, -1.05, 1.5, -0.3, blink);
  const parry = group('kit_parry', arms);
  box(0.5, 0.5, 0.1, glow, 1.2, 0, 1.1, parry); box(0.5, 0.5, 0.1, glow, -1.2, 0, 1.1, parry);
  const shield = group('kit_shield', arms);
  box(0.9, 1.2, 0.15, plate, 1.2, 0, 1.15, shield); box(0.9, 1.2, 0.15, plate, -1.2, 0, 1.15, shield);
  // Three plates per section, placed on the matching side.
  const place: Record<string, (i: number) => [number, number, number, number, number, number]> = {
    front: i => [0.55, 0.3, 0.12, (i - 1) * 0.6, 2.05, 0.86],
    rear: i => [0.55, 0.3, 0.12, (i - 1) * 0.6, 2.25, -0.86],
    left: i => [0.12, 0.3, 0.45, 1.01, 1.7 + i * 0.32, 0],
    right: i => [0.12, 0.3, 0.45, -1.01, 1.7 + i * 0.32, 0],
  };
  for (const s of SECTIONS) for (let i = 0; i < 3; i++) { const [w, h, d, x, y, z] = place[s]!(i); box(w, h, d, plate, x, y, z, body, `plate_${s}_${i + 1}`); }
  return g;
}

export async function makeMech(): Promise<THREE.Object3D> {
  const glb = await load('mech');
  const obj = glb ? glb.clone(true) : fallbackMech();
  prepare(obj);
  const box = new THREE.Box3().setFromObject(obj);
  // Keep the model at the collision height.
  const h = box.max.y - box.min.y;
  if (h > 0.1 && Math.abs(h - MECH.height) > 0.8) obj.scale.multiplyScalar(MECH.height / h);
  return obj;
}

/** Shows the parts of the chosen kit and hides the others. */
export function applyKit(mech: THREE.Object3D, kit: MechKit): void {
  for (const name of ['boost', 'blink', 'jump', 'hover', 'parry', 'shield']) {
    const node = mech.getObjectByName(`kit_${name}`);
    if (node) node.visible = kit.move === name || kit.air === name || kit.guard === name;
  }
}

/** Arena visual; null means the renderer draws the built-in city. */
export function loadArena(): Promise<THREE.Group | null> { return load('arena').then(g => { if (g) prepare(g); return g; }); }
