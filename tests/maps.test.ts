import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Arena, initPhysics, REST_MECH, REST_TOP, type MechInput, type TopInput } from '../src/sim/arena.ts';
import { clampInside, onFloor } from '../src/sim/bowl.ts';
import { BELTS, BUILDINGS, BUMPERS, MAP, POSTS, pushOutOfBox, pushOutOfTree, SAWS, sawPosition, setMap, SPAWNS, TREES, TUNNEL_BOXES, WALLS } from '../src/sim/city.ts';
import { MAP_IDS, MAPS, readMapId } from '../src/sim/maps.ts';
import { FALL, HAZARD, MECH, TOP } from '../src/tuning.ts';

beforeAll(async () => { await initPhysics(); });
// The active map is module state: leave City Bowl active after each test.
afterEach(() => { setMap('city'); });

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
      [...BUILDINGS, ...WALLS, ...TUNNEL_BOXES].some(b => pushOutOfBox(b, x, z, r)) || TREES.some(t => pushOutOfTree(t, x, z, r)) || POSTS.some(p => Math.hypot(x - p.x, z - p.z) < p.r + r);
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
    expect(a.mech.x).toBeLessThanOrEqual(24.2 - MECH.radius + 1e-6);
    expect(a.shadows).toHaveLength(1);
    const p = a.shadows[0]!.body.translation();
    expect(Math.abs(p.x)).toBeLessThanOrEqual(24.2);
    expect(p.y).toBeGreaterThan(-0.5);
    a.dispose();
  });
});

describe('hazards', () => {
  it('a belt carries a top faster than its normal top speed', () => {
    const a = new Arena(1, 0, undefined, [], 'yard');
    const top = a.tops[0]!, b = BELTS[0]!; // along +X at z = −12
    top.body.setTranslation({ x: b.x - 15, y: TOP.radius + 0.02, z: b.z }, true);
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    let best = 0;
    for (let i = 0; i < 60; i++) { a.step([REST_TOP], REST_MECH); best = Math.max(best, top.body.linvel().x); }
    expect(best).toBeGreaterThan(TOP.maxSpeed + 3);
    expect(best).toBeLessThanOrEqual(HAZARD.beltTopSpeed + 0.5);
    a.dispose();
  });
  it('a belt moves the mech on the ground', () => {
    const a = new Arena(0, 0, undefined, [], 'yard');
    a.mech.x = -10; a.mech.z = -12;
    run(a, 1);
    expect(a.mech.x).toBeGreaterThan(-10 + HAZARD.beltMechSpeed * 0.8);
    a.dispose();
  });
  it('a saw throws a top away and pushes the mech without damage', () => {
    const a = new Arena(1, 0, undefined, [], 'sawmill');
    const c = sawPosition(SAWS[0]!, a.clock + 1 / 60);
    const top = a.tops[0]!;
    top.body.setTranslation({ x: c.x, y: TOP.radius + 0.02, z: c.z + 1.5 }, true);
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    a.step([REST_TOP], REST_MECH);
    expect(a.drainEvents().some(e => e.k === 'saw')).toBe(true);
    expect(Math.hypot(top.body.linvel().x, top.body.linvel().z)).toBeGreaterThan(HAZARD.sawThrow - 3);
    const m = new Arena(0, 0, undefined, [], 'sawmill');
    const c2 = sawPosition(SAWS[0]!, m.clock + 1 / 60);
    m.mech.x = c2.x; m.mech.z = c2.z + 2;
    m.step([], REST_MECH);
    expect(m.view().mech.control).toBe(false);
    expect(m.mech.status.health).toBe(MECH.health);
    expect(m.mech.status.slows).toHaveLength(0);
    a.dispose(); m.dispose();
  });
  it('a bumper kicks a top away and blocks the mech', () => {
    const a = new Arena(1, 0, undefined, [], 'bumpers');
    const b = BUMPERS[0]!, top = a.tops[0]!;
    top.body.setTranslation({ x: b.x + 3, y: TOP.radius + 0.02, z: b.z }, true);
    top.body.setLinvel({ x: -6, y: 0, z: 0 }, true);
    let kicked = false;
    for (let i = 0; i < 60 && !kicked; i++) { a.step([REST_TOP], REST_MECH); kicked = a.drainEvents().some(e => e.k === 'bump'); }
    expect(kicked).toBe(true);
    expect(top.body.linvel().x).toBeGreaterThan(HAZARD.bumperKick - 3);
    a.mech.x = b.x - 5; a.mech.z = b.z;
    run(a, 1.5, [REST_TOP], { ...REST_MECH, mx: 1 });
    expect(Math.hypot(a.mech.x - b.x, a.mech.z - b.z)).toBeGreaterThanOrEqual(HAZARD.bumperRadius + MECH.radius - 0.01);
    a.dispose();
  });
});
