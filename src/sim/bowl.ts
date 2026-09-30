import { ARENA } from '../tuning.ts';
import layout from '../arena-layout.json';

const SX = ARENA.stretch;

/** Height of the bowl at normalized radius ρ (see rho). Shared by physics, rendering and Blender. */
export function bowlHeight(r: number): number {
  const floor = ARENA.floorCurve * Math.min(r, ARENA.floorRadius) ** 2;
  if (r <= ARENA.floorRadius) return floor;
  const t = Math.min(1, (r - ARENA.floorRadius) / (ARENA.rimRadius - ARENA.floorRadius));
  // Quarter-ellipse rim: steepens smoothly into the wall, so there are no corners to trap a top.
  return floor + (ARENA.rimHeight - floor) * (1 - Math.sqrt(1 - t * t));
}

/** Normalized radius of the oval bowl: x is divided by the stretch. */
export function rho(x: number, z: number): number { return Math.hypot(x / SX, z); }
export function surfaceHeight(x: number, z: number): number { return bowlHeight(rho(x, z)); }

/**
 * Keeps a point inside the oval ρ ≤ limit. Returns the corrected point and the outward normal
 * (in world space) when the point was outside, or null when it was inside.
 */
export function clampOval(x: number, z: number, limit: number): { x: number; z: number; nx: number; nz: number } | null {
  const r = rho(x, z);
  if (r <= limit) return null;
  const k = limit / r;
  const cx = x * k, cz = z * k;
  const gx = cx / (SX * SX), gz = cz, g = Math.hypot(gx, gz) || 1;
  return { x: cx, z: cz, nx: gx / g, nz: gz / g };
}

export interface MeshData { vertices: Float32Array; indices: Uint32Array }

/** Oval surface of revolution for the bowl, as a triangle mesh. */
export function bowlMesh(rings = ARENA.rings, segments = ARENA.segments): MeshData {
  const radii: number[] = [];
  for (let i = 0; i <= rings; i++) radii.push(ARENA.rimRadius * Math.sin(((i / rings) * Math.PI) / 2)); // denser near the rim
  const vertices: number[] = [0, bowlHeight(0), 0];
  for (let i = 1; i < radii.length; i++) {
    const r = radii[i]!, y = bowlHeight(r);
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      vertices.push(Math.cos(a) * r * SX, y, Math.sin(a) * r);
    }
  }
  const indices: number[] = [];
  const ring = (i: number, j: number) => 1 + (i - 1) * segments + (j % segments);
  for (let j = 0; j < segments; j++) indices.push(0, ring(1, j + 1), ring(1, j));
  for (let i = 1; i < radii.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j), d = ring(i + 1, j + 1);
      indices.push(a, b, c, b, d, c);
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

/** Vertical wall above the rim so nothing leaves the arena. */
export function wallMesh(height = 6, segments = ARENA.segments): MeshData {
  const r = ARENA.rimRadius, y0 = ARENA.rimHeight - 1, y1 = ARENA.rimHeight + height;
  const vertices: number[] = [];
  for (let j = 0; j < segments; j++) {
    const a = (j / segments) * Math.PI * 2;
    vertices.push(Math.cos(a) * r * SX, y0, Math.sin(a) * r, Math.cos(a) * r * SX, y1, Math.sin(a) * r);
  }
  const indices: number[] = [];
  for (let j = 0; j < segments; j++) {
    const a = j * 2, b = ((j + 1) % segments) * 2;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

/** A half wall as a box: centre, half extents along its length (hx) and thickness (hz), and yaw about +Y. */
export interface WallBox { x: number; y: number; z: number; hx: number; hy: number; hz: number; angle: number; dirX: number; dirZ: number }

/** Boxes for the half walls. Each one reaches below the curved floor and rises `height` above its highest point. */
export function wallBoxes(): WallBox[] {
  return layout.walls.map(w => {
    const angle = (w.angle * Math.PI) / 180, dirX = Math.cos(angle), dirZ = Math.sin(angle);
    const hx = w.length / 2, hz = layout.thickness / 2;
    let lo = Infinity, hi = -Infinity;
    for (const s of [-1, -0.5, 0, 0.5, 1]) for (const t of [-1, 1]) {
      const h = surfaceHeight(w.x + dirX * hx * s - dirZ * hz * t, w.z + dirZ * hx * s + dirX * hz * t);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    const bottom = lo - 0.4, top = hi + layout.height;
    return { x: w.x, y: (bottom + top) / 2, z: w.z, hx, hy: (top - bottom) / 2, hz, angle, dirX, dirZ };
  });
}

/**
 * Pushes a circle of `radius` at (x, z) out of a wall. Returns the new centre and the push normal,
 * or null when there is no overlap.
 */
export function pushOutOfWall(w: WallBox, x: number, z: number, radius: number): { x: number; z: number; nx: number; nz: number } | null {
  // Into the wall's frame: u along the length, v across it.
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
