import layout from '../arena-layout.json';
import { surfaceHeight, type MeshData } from './bowl.ts';

/**
 * The city inside the bowl: buildings, half walls, tunnels and trees from src/arena-layout.json.
 * Everything sits on the curved floor. Positions are game metres; angles turn +X toward +Z.
 */

/** A box standing on the floor: centre, half extents along its length (hx), height (hy) and depth (hz). */
export interface Box { x: number; y: number; z: number; hx: number; hy: number; hz: number; angle: number; dirX: number; dirZ: number; top: number }

function drapedBox(x: number, z: number, length: number, depth: number, height: number, angleDeg: number): Box {
  const angle = (angleDeg * Math.PI) / 180, dirX = Math.cos(angle), dirZ = Math.sin(angle);
  const hx = length / 2, hz = depth / 2;
  let lo = Infinity, hi = -Infinity;
  for (const s of [-1, -0.5, 0, 0.5, 1]) for (const t of [-1, 0, 1]) {
    const h = surfaceHeight(x + dirX * hx * s - dirZ * hz * t, z + dirZ * hx * s + dirX * hz * t);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  // Reach below the lowest floor point; rise `height` above the highest one.
  const bottom = lo - 0.4, top = hi + height;
  return { x, y: (bottom + top) / 2, z, hx, hy: (top - bottom) / 2, hz, angle, dirX, dirZ, top };
}

export const WALLS: Box[] = layout.walls.map(w => drapedBox(w.x, w.z, w.length, layout.wall.thickness, layout.wall.height, w.angle));
export const BUILDINGS: Box[] = layout.buildings.map(b => drapedBox(b.x, b.z, b.w, b.d, b.h, 0));
export const SPAWNS: [number, number][] = layout.spawns.map(([x, z]) => [x!, z!]);

export interface Tree { x: number; z: number; base: number }
export const TREE = layout.tree;
export const TREES: Tree[] = layout.trees.map(([x, z]) => ({ x: x!, z: z!, base: surfaceHeight(x!, z!) }));

export interface Tunnel { x: number; z: number; angle: number; dirX: number; dirZ: number }
export const TUNNEL = layout.tunnel;
export const TUNNELS: Tunnel[] = layout.tunnels.map(t => {
  const angle = (t.angle * Math.PI) / 180;
  return { x: t.x, z: t.z, angle, dirX: Math.cos(angle), dirZ: Math.sin(angle) };
});

/** Position in a tunnel's frame: u along its passage, v across it. */
export function tunnelLocal(t: Tunnel, x: number, z: number): { u: number; v: number } {
  const dx = x - t.x, dz = z - t.z;
  return { u: dx * t.dirX + dz * t.dirZ, v: -dx * t.dirZ + dz * t.dirX };
}
function toWorld(t: Tunnel, u: number, v: number): [number, number] { return [t.x + u * t.dirX - v * t.dirZ, t.z + u * t.dirZ + v * t.dirX]; }

/** Height of a tunnel's outer profile at offset v across it (0 outside the profile). */
export function humpHeight(v: number): number {
  const pts = TUNNEL.outer;
  for (let i = 0; i < pts.length - 1; i++) {
    const [v0, y0] = pts[i]!, [v1, y1] = pts[i + 1]!;
    if (v >= v0! && v <= v1!) return y0! + ((y1! - y0!) * (v - v0!)) / (v1! - v0! || 1);
  }
  return 0;
}

/** How far above the floor the top of a tunnel is at (x, z). The mech walks over tunnels. */
export function tunnelLift(x: number, z: number): number {
  let lift = 0;
  for (const t of TUNNELS) {
    const { u, v } = tunnelLocal(t, x, z);
    if (Math.abs(u) <= TUNNEL.length / 2) lift = Math.max(lift, humpHeight(v));
  }
  return lift;
}

/** True when (x, z) is under a tunnel roof. */
export function underTunnel(x: number, z: number, margin = 0): boolean {
  return TUNNELS.some(t => {
    const { u, v } = tunnelLocal(t, x, z);
    return Math.abs(u) <= TUNNEL.length / 2 - margin && Math.abs(v) <= TUNNEL.outer[1]![0]! * -1 - margin;
  });
}

/**
 * A tunnel as a draped triangle mesh: the outer hump (ramps and roof), the passage walls and ceiling,
 * and the two end faces with their openings. The end-face triangles assume a four-point outer profile
 * and a rectangular passage, as in the layout file.
 */
export function tunnelMesh(t: Tunnel, steps = 8): MeshData {
  const L = TUNNEL.length / 2, hw = TUNNEL.inner.halfWidth, ih = TUNNEL.inner.height;
  const vertices: number[] = [], indices: number[] = [];
  const vert = (u: number, v: number, h: number) => {
    const [x, z] = toWorld(t, u, v);
    vertices.push(x, surfaceHeight(x, z) + h, z);
    return vertices.length / 3 - 1;
  };
  // A strip along u between two cross-section points.
  const strip = (a: [number, number], b: [number, number]) => {
    let prevA = vert(-L, a[0], a[1]), prevB = vert(-L, b[0], b[1]);
    for (let i = 1; i <= steps; i++) {
      const u = -L + (2 * L * i) / steps;
      const na = vert(u, a[0], a[1]), nb = vert(u, b[0], b[1]);
      indices.push(prevA, prevB, nb, prevA, nb, na);
      prevA = na; prevB = nb;
    }
  };
  const outer = TUNNEL.outer as [number, number][];
  for (let i = 0; i < outer.length - 1; i++) strip(outer[i]!, outer[i + 1]!);
  strip([hw, 0], [hw, ih]);
  strip([hw, ih], [-hw, ih]);
  strip([-hw, ih], [-hw, 0]);
  const [o0, o1, o2, o3] = outer;
  const cap: [number, number][][] = [
    [o0!, o1!, [-hw, ih]], [o0!, [-hw, ih], [-hw, 0]],
    [o1!, o2!, [hw, ih]], [o1!, [hw, ih], [-hw, ih]],
    [o2!, o3!, [hw, 0]], [o2!, [hw, 0], [hw, ih]],
  ];
  for (const u of [-L, L]) for (const tri of cap) indices.push(...tri.map(([v, h]) => vert(u, v, h)));
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

/**
 * Pushes a circle of `radius` at (x, z) out of a box. Returns the new centre and the push normal
 * (pointing away from the box), or null when there is no overlap.
 */
export function pushOutOfBox(w: Box, x: number, z: number, radius: number): { x: number; z: number; nx: number; nz: number } | null {
  // Into the box's frame: u along the length, v across it.
  const dx = x - w.x, dz = z - w.z;
  const u = dx * w.dirX + dz * w.dirZ, v = -dx * w.dirZ + dz * w.dirX;
  const cu = Math.max(-w.hx, Math.min(w.hx, u)), cv = Math.max(-w.hz, Math.min(w.hz, v));
  let ou = u - cu, ov = v - cv, push: number;
  const d = Math.hypot(ou, ov);
  if (d >= radius) return null;
  if (d > 1e-6) push = radius - d;
  else {
    // The centre is inside the box: leave by the nearest face.
    const pu = w.hx - Math.abs(u), pv = w.hz - Math.abs(v);
    if (pu < pv) { ou = Math.sign(u) || 1; ov = 0; push = radius + pu; } else { ou = 0; ov = Math.sign(v) || 1; push = radius + pv; }
  }
  const len = Math.hypot(ou, ov), nu = ou / len, nv = ov / len;
  const nx = nu * w.dirX - nv * w.dirZ, nz = nu * w.dirZ + nv * w.dirX;
  return { x: x + nx * push, z: z + nz * push, nx, nz };
}

/** Pushes a circle out of a tree trunk. */
export function pushOutOfTree(t: Tree, x: number, z: number, radius: number): { x: number; z: number; nx: number; nz: number } | null {
  const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz), min = radius + TREE.trunk;
  if (d >= min) return null;
  const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
  return { x: t.x + nx * min, z: t.z + nz * min, nx, nz };
}

/** True when a circle at (x, z) overlaps any building (the obstacles a jump or blink cannot pass). */
export function hitsBuilding(x: number, z: number, radius: number): boolean {
  return BUILDINGS.some(b => pushOutOfBox(b, x, z, radius) !== null);
}
