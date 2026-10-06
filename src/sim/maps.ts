import cityLayout from '../arena-layout.json';
import type { Floor } from './bowl.ts';

/** The maps the host can pick. City Bowl comes from src/arena-layout.json (shared with Blender); the others are flat. */
export type MapId = 'city' | 'yard' | 'sawmill' | 'bumpers';
export const MAP_IDS: readonly MapId[] = ['city', 'yard', 'sawmill', 'bumpers'];
export function readMapId(v: unknown): MapId | null { return (MAP_IDS as readonly unknown[]).includes(v) ? v as MapId : null; }

/** Same format as src/arena-layout.json. Tunnel and tree shapes are shared by every map. */
export type Layout = typeof cityLayout;
/** A conveyor belt: centre, length along `angle` (degrees, +X toward +Z), width across. It carries things toward +angle. */
export interface Belt { x: number; z: number; length: number; width: number; angle: number }
/** A saw blade that moves back and forth between two points; one full trip there and back takes `period` seconds. */
export interface Saw { from: [number, number]; to: [number, number]; period: number }
export interface MapDef {
  id: MapId; name: string; blurb: string;
  floor: Floor; layout: Layout; mechStart: [number, number];
  belts: Belt[]; saws: Saw[]; bumpers: [number, number][];
}

const flat = (part: Pick<Layout, 'spawns' | 'walls' | 'buildings'> & Partial<Pick<Layout, 'trees'>>): Layout =>
  ({ ...cityLayout, note: '', tunnels: [], trees: [], ...part });
const ring = (n: number, radius: number, startDeg: number): [number, number][] => Array.from({ length: n }, (_, k) => {
  const a = ((startDeg + (360 / n) * k) * Math.PI) / 180;
  return [Math.round(Math.cos(a) * radius * 100) / 100, Math.round(Math.sin(a) * radius * 100) / 100];
});

export const MAPS: Record<MapId, MapDef> = {
  city: {
    id: 'city', name: 'City Bowl', blurb: 'A city in an oval bowl: buildings, tunnels and trees to hide behind.',
    floor: { kind: 'bowl' }, layout: cityLayout, mechStart: [0, 0], belts: [], saws: [], bumpers: [],
  },
  yard: {
    id: 'yard', name: 'Conveyor Yard', blurb: 'Conveyor belts carry you fast one way and slow you down the other way.',
    floor: { kind: 'flat', outline: [[-30, -20], [30, -20], [30, 20], [-30, 20]], open: false },
    layout: flat({
      spawns: [[-26, -16], [26, 16], [26, -16], [-26, 16]],
      walls: [{ x: 0, z: -16, length: 6, angle: 0 }, { x: 0, z: 16, length: 6, angle: 0 }],
      buildings: [
        { x: -14, z: 0, w: 4, d: 4, h: 3 }, { x: 14, z: 0, w: 4, d: 4, h: 3 },
        { x: -26, z: 0, w: 3, d: 6, h: 4 }, { x: 26, z: 0, w: 3, d: 6, h: 4 },
      ],
    }),
    mechStart: [0, 0],
    // A loop around the yard (clockwise on screen) and two short belts through the middle, opposite ways.
    belts: [
      { x: 0, z: -12, length: 44, width: 3, angle: 0 }, { x: 22, z: 0, length: 24, width: 3, angle: 90 },
      { x: 0, z: 12, length: 44, width: 3, angle: 180 }, { x: -22, z: 0, length: 24, width: 3, angle: 270 },
      { x: -6, z: 0, length: 14, width: 3, angle: 90 }, { x: 6, z: 0, length: 14, width: 3, angle: 270 },
    ],
    saws: [], bumpers: [],
  },
  sawmill: {
    id: 'sawmill', name: 'Sawmill', blurb: 'A platform with open edges and moving saw blades. A top that falls comes back after 3 s.',
    floor: { kind: 'flat', outline: [[-22, -22], [22, -22], [22, 22], [-22, 22]], open: true },
    layout: flat({
      spawns: [[-16, -15], [16, 15], [16, -15], [-16, 15]],
      // Short rails in the middle of each edge; the corners are open.
      walls: [
        { x: 0, z: -21.6, length: 14, angle: 0 }, { x: 0, z: 21.6, length: 14, angle: 0 },
        { x: -21.6, z: 0, length: 14, angle: 90 }, { x: 21.6, z: 0, length: 14, angle: 90 },
      ],
      buildings: [
        { x: -8, z: 0, w: 3, d: 3, h: 4 }, { x: 8, z: 0, w: 3, d: 3, h: 4 },
        { x: 0, z: -15, w: 4, d: 2, h: 3 }, { x: 0, z: 15, w: 4, d: 2, h: 3 },
      ],
    }),
    mechStart: [0, 0], belts: [],
    saws: [{ from: [-15, -8], to: [15, -8], period: 6 }, { from: [15, 8], to: [-15, 8], period: 7 }],
    bumpers: [],
  },
  bumpers: {
    id: 'bumpers', name: 'Bumper Park', blurb: 'Pinball bumpers kick tops away at high speed.',
    floor: { kind: 'flat', outline: ring(8, 26, 22.5), open: false },
    layout: flat({ spawns: [[-17.32, -10], [17.32, -10], [0, 20], [-20, 0]], walls: [], buildings: [] }),
    mechStart: [0, 0], belts: [], saws: [],
    bumpers: [...ring(6, 9, 0), ...ring(3, 18, 30)],
  },
};
