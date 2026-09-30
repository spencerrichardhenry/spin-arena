import { ARENA } from '../tuning.ts';

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
