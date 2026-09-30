import { ARENA } from '../tuning.ts';

/** Height of the bowl surface at distance r from the centre. Shared by physics, rendering and Blender. */
export function bowlHeight(r: number): number {
  const floor = ARENA.floorCurve * Math.min(r, ARENA.floorRadius) ** 2;
  if (r <= ARENA.floorRadius) return floor;
  const t = Math.min(1, (r - ARENA.floorRadius) / (ARENA.rimRadius - ARENA.floorRadius));
  // Quarter-ellipse rim: steepens smoothly into the wall, so there are no corners to trap a top.
  return floor + (ARENA.rimHeight - floor) * (1 - Math.sqrt(1 - t * t));
}

export interface MeshData { vertices: Float32Array; indices: Uint32Array }

/** Surface of revolution for the bowl, as a triangle mesh. */
export function bowlMesh(rings = ARENA.rings, segments = ARENA.segments): MeshData {
  const radii: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    // More rings near the rim, where the curve is steep.
    radii.push(ARENA.rimRadius * Math.sin((t * Math.PI) / 2));
  }
  const vertices: number[] = [0, bowlHeight(0), 0];
  for (let i = 1; i < radii.length; i++) {
    const r = radii[i]!, y = bowlHeight(r);
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      vertices.push(Math.cos(a) * r, y, Math.sin(a) * r);
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
    vertices.push(Math.cos(a) * r, y0, Math.sin(a) * r, Math.cos(a) * r, y1, Math.sin(a) * r);
  }
  const indices: number[] = [];
  for (let j = 0; j < segments; j++) {
    const a = j * 2, b = ((j + 1) % segments) * 2;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
