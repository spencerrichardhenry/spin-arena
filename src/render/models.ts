import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MECH, TOP } from '../tuning.ts';
import { SECTIONS } from '../sim/rules.ts';

/**
 * Model contract (shared with scripts/blender): +Z forward, +Y up, metres.
 * Top: a node named `spin` that turns about Y; the lowest point is the tip at y = 0.
 * Mech: nodes `legL` (+X side), `legR` (−X side), `thrusters`, `arms`, and 12 plates named `plate_<section>_<1..3>`.
 * The mech origin is at its feet.
 */

export const TOP_COLORS = [0xff5a4f, 0x3fa9ff, 0x52e07a, 0xffc93f];
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group | null>>();

function base(): string { return import.meta.env.BASE_URL; }
function load(name: string): Promise<THREE.Group | null> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(`${base()}models/${name}.glb`).then(g => g.scene as THREE.Group).catch(() => {
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

function fallbackTop(color: number): THREE.Group {
  const g = new THREE.Group();
  const spin = new THREE.Group(); spin.name = 'spin'; g.add(spin);
  const metal = new THREE.MeshStandardMaterial({ color: 0xc9d2dc, metalness: 0.8, roughness: 0.3 });
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.4 });
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.35, 16), metal); tip.rotation.x = Math.PI; tip.position.y = 0.18; spin.add(tip);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.5, 0.22, 12), paint); ring.position.y = 0.45; spin.add(ring);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.18), metal);
    const a = (i / 3) * Math.PI * 2; blade.position.set(Math.cos(a) * 0.52, 0.45, Math.sin(a) * 0.52); blade.rotation.y = -a + 0.5; spin.add(blade);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.18, 16), metal); cap.position.y = 0.64; spin.add(cap);
  return g;
}

export async function makeTop(index: number): Promise<THREE.Object3D> {
  const glb = await load(`top_${index}`);
  const obj = glb ? glb.clone(true) : fallbackTop(TOP_COLORS[index % TOP_COLORS.length]!);
  if (!obj.getObjectByName('spin')) { const spin = new THREE.Group(); spin.name = 'spin'; spin.add(...obj.children); obj.add(spin); }
  prepare(obj);
  return obj;
}

/** One merged geometry of a top, for the instanced shadow mesh. */
export async function shadowGeometry(): Promise<THREE.BufferGeometry> {
  const glb = await load('top_0');
  const src = glb ?? fallbackTop(0xffffff);
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
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, name = '') => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); mesh.name = name; parent.add(mesh); return mesh;
  };
  for (const [name, x] of [['legL', 0.75], ['legR', -0.75]] as const) {
    const leg = new THREE.Group(); leg.name = name; leg.position.set(x, 1.3, 0); g.add(leg);
    box(0.45, 1.2, 0.5, dark, 0, -0.65, 0, leg); box(0.6, 0.15, 0.85, hull, 0, -1.22, 0.1, leg);
  }
  const body = new THREE.Group(); body.name = 'body'; g.add(body);
  box(1.9, 1.1, 1.6, hull, 0, 1.9, 0, body);
  box(0.9, 0.45, 0.7, dark, 0, 2.65, 0.25, body, 'cockpit');
  const arms = new THREE.Group(); arms.name = 'arms'; arms.position.set(0, 2, 0); body.add(arms);
  box(0.4, 0.4, 1.3, dark, 1.2, 0, 0.4, arms); box(0.4, 0.4, 1.3, dark, -1.2, 0, 0.4, arms);
  const thrusters = new THREE.Group(); thrusters.name = 'thrusters'; thrusters.position.set(0, 1.9, -0.9); body.add(thrusters);
  box(0.4, 0.8, 0.4, dark, 0.5, 0, 0, thrusters); box(0.4, 0.8, 0.4, dark, -0.5, 0, 0, thrusters);
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

/** Arena visual; null means the renderer draws the built-in bowl. */
export function loadArena(): Promise<THREE.Group | null> { return load('arena').then(g => { if (g) prepare(g); return g; }); }
