import { beforeAll, describe, expect, it } from 'vitest';
import { Arena, initPhysics, REST_MECH, REST_TOP, type MechInput, type TopInput } from '../src/sim/arena.ts';
import { clampInside, onFloor } from '../src/sim/bowl.ts';
import { BUILDINGS, MAP, pushOutOfBox, pushOutOfTree, setMap, SPAWNS, TREES, TUNNEL_BOXES, WALLS } from '../src/sim/city.ts';
import { MAP_IDS, MAPS, readMapId } from '../src/sim/maps.ts';
import { FALL, MECH, TOP } from '../src/tuning.ts';

beforeAll(async () => { await initPhysics(); });

function run(arena: Arena, seconds: number, tops: TopInput[] = [], mech: MechInput = REST_MECH): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) arena.step(tops, mech);
}

describe('maps', () => {
  it('has four maps with names', () => {
    expect(MAP_IDS).toEqual(['city', 'yard', 'sawmill', 'bumpers']);
    expect(MAP_IDS.map(id => MAPS[id].name)).toEqual(['City Bowl', 'Conveyor Yard', 'Sawmill', 'Bumper Park']);
    expect(readMapId('yard')).toBe('yard');
    expect(readMapId('moon')).toBeNull();
  });
  for (const id of MAP_IDS) it(`${id}: spawn points and the mech start are on the floor and clear`, () => {
    setMap(id);
    const blocked = (x: number, z: number, r: number) =>
      [...BUILDINGS, ...WALLS, ...TUNNEL_BOXES].some(b => pushOutOfBox(b, x, z, r)) || TREES.some(t => pushOutOfTree(t, x, z, r));
    for (const [x, z] of SPAWNS) {
      expect(onFloor(x, z)).toBe(true);
      expect(clampInside(x, z, TOP.radius)).toBeNull();
      expect(blocked(x, z, TOP.radius + 0.5)).toBe(false);
    }
    const [mx, mz] = MAP.mechStart;
    expect(blocked(mx, mz, MECH.radius)).toBe(false);
    expect(SPAWNS.length).toBeGreaterThanOrEqual(4);
  });
  it('a rim map keeps a fast top inside', () => {
    const a = new Arena(1, 0, undefined, [], 'yard');
    const top = a.tops[0]!;
    top.body.setTranslation({ x: 25, y: TOP.radius + 0.02, z: -16 }, true);
    top.body.setLinvel({ x: 30, y: 0, z: 0 }, true);
    run(a, 1, [REST_TOP]);
    const p = top.body.translation();
    expect(p.x).toBeLessThan(30);
    expect(p.y).toBeGreaterThan(-0.5);
    a.dispose();
  });
  it('Sawmill: a top that rolls off falls, is out for 3 s, ignores presses, and respawns clean at a spawn', () => {
    const a = new Arena(1, 0, { move: 'boost', air: 'jump', guard: 'lock' }, [], 'sawmill');
    const top = a.tops[0]!;
    top.body.setTranslation({ x: 20, y: TOP.radius + 0.02, z: -15 }, true); // by the open east edge, clear of the rail
    top.body.setLinvel({ x: 15, y: 0, z: 0 }, true);
    let fell = false;
    for (let i = 0; i < 120 && !fell; i++) { a.step([REST_TOP], REST_MECH); fell = a.drainEvents().some(e => e.k === 'fall'); }
    expect(fell).toBe(true);
    expect(a.view().tops[0]!.out).toBe(true);
    // Presses while out do nothing; the mech's lock does not reach it.
    run(a, 1, [{ ...REST_TOP, dash: 1 }], { ...REST_MECH, parry: 1 });
    expect(a.view().tops[0]!.dashCd).toBe(0);
    expect(a.view().tops[0]!.locked).toBe(false);
    run(a, FALL.respawnTime, [{ ...REST_TOP, dash: 1 }], { ...REST_MECH, parry: 1 });
    const v = a.view().tops[0]!;
    expect(v.out).toBe(false);
    expect(v.locked).toBe(false);
    expect(SPAWNS.some(([x, z]) => Math.hypot(v.x - x, v.z - z) < 1.5)).toBe(true);
    a.dispose();
  });
  it('Sawmill: the mech and the shadows stay on the platform', () => {
    const a = new Arena(0, 0, undefined, [], 'sawmill');
    a.mech.z = -18.5; // south of the pillar at (0, −15), clear of the saw track at z = −8
    a.addShadow(0, 18, -18, 1, 0);
    run(a, 4, [], { ...REST_MECH, mx: 1 });
    expect(a.mech.x).toBeLessThanOrEqual(22 - MECH.radius + 1e-6);
    expect(a.shadows).toHaveLength(1);
    const p = a.shadows[0]!.body.translation();
    expect(Math.abs(p.x)).toBeLessThanOrEqual(22);
    expect(p.y).toBeGreaterThan(-0.5);
    a.dispose();
  });
});
