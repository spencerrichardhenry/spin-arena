import { beforeAll, describe, expect, it } from 'vitest';
import { Arena, initPhysics, REST_MECH, REST_TOP, type MechInput, type TopInput } from '../src/sim/arena.ts';
import { bowlHeight, pushOutOfWall, rho, surfaceHeight, wallBoxes } from '../src/sim/bowl.ts';
import { ARENA, MECH, SHADOW, TOP } from '../src/tuning.ts';

beforeAll(async () => { await initPhysics(); });

function run(arena: Arena, seconds: number, tops: TopInput[] = [], mech: MechInput = REST_MECH): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) arena.step(tops, mech);
}
const speedXZ = (v: { x: number; z: number }) => Math.hypot(v.x, v.z);

describe('bowl', () => {
  it('is continuous and rises to the rim', () => {
    expect(bowlHeight(0)).toBe(0);
    expect(bowlHeight(ARENA.rimRadius)).toBeCloseTo(ARENA.rimHeight);
    for (let r = 0; r < ARENA.rimRadius; r += 0.05) expect(bowlHeight(r + 0.05)).toBeGreaterThanOrEqual(bowlHeight(r));
  });
});

describe('arena', () => {
  it('does nothing during the countdown', () => {
    const a = new Arena(1, 1);
    const start = a.tops[0]!.body.translation();
    run(a, 0.9, [{ ...REST_TOP, mx: 1 }]);
    expect(a.clock).toBeLessThan(0);
    expect(a.tops[0]!.body.translation().x).toBeCloseTo(start.x);
    a.dispose();
  });

  it('rolls an idle top back toward the centre', () => {
    const a = new Arena(1, 0);
    const r0 = Math.hypot(a.tops[0]!.body.translation().x, a.tops[0]!.body.translation().z);
    run(a, 1.5);
    const p = a.tops[0]!.body.translation();
    expect(Math.hypot(p.x, p.z)).toBeLessThan(r0);
    a.dispose();
  });

  it('dashes toward the aim point and replays the dash as a shadow after the delay', () => {
    const a = new Arena(1, 0);
    const start = { ...a.tops[0]!.body.translation() };
    const input: TopInput = { ...REST_TOP, ax: start.x + 10, az: start.z, dash: 1 };
    run(a, 0.25, [input]);
    const v = a.tops[0]!.body.linvel();
    expect(v.x).toBeCloseTo(TOP.dashSpeed, 0);
    expect(Math.abs(v.z)).toBeLessThan(1);
    run(a, SHADOW.delay - 0.35, [input]);
    expect(a.shadows).toHaveLength(0);
    run(a, 0.2, [input]);
    expect(a.shadows).toHaveLength(1);
    const sp = a.shadows[0]!.body.translation();
    expect(Math.hypot(sp.x - start.x, sp.z - start.z)).toBeLessThan(2);
    a.dispose();
  });

  it('ignores a second dash during the cooldown', () => {
    const a = new Arena(1, 0);
    run(a, 0.1, [{ ...REST_TOP, dash: 1 }]);
    run(a, 1, [{ ...REST_TOP, dash: 2 }]);
    run(a, SHADOW.delay + 1);
    expect(a.shadows).toHaveLength(1);
    a.dispose();
  });

  it('keeps shadows at constant speed and inside the bowl for a long time', () => {
    const a = new Arena(0, 0);
    for (let i = 0; i < 12; i++) { const ang = i * 0.5; a.addShadow(0, Math.cos(ang) * 5, Math.sin(ang) * 5, Math.cos(ang * 3), Math.sin(ang * 3)); }
    a.mech.x = 100; // move the mech away so it does not interfere
    run(a, 60);
    for (const sh of a.shadows) {
      const p = sh.body.translation();
      expect(rho(p.x, p.z)).toBeLessThan(ARENA.rimRadius + 0.1);
      expect(p.y).toBeGreaterThan(-0.5);
      expect(speedXZ(sh.body.linvel())).toBeCloseTo(SHADOW.speed, 1);
    }
    a.dispose();
  });

  it('keeps tops in the arena when they drive into the rim', () => {
    const a = new Arena(1, 0);
    run(a, 8, [{ ...REST_TOP, mx: 1, mz: 0.2, ax: 50, az: 0, dash: 1 }]);
    const p = a.tops[0]!.body.translation();
    expect(rho(p.x, p.z)).toBeLessThan(ARENA.rimRadius);
    a.dispose();
  });

  it('damages the section a fast top strikes, and bounces the top', () => {
    const a = new Arena(1, 0);
    const top = a.tops[0]!;
    // Mech faces -Z (yaw π). Place the top behind it (+Z) and dash forward.
    top.body.setTranslation({ x: 0, y: bowlHeight(5) + TOP.radius, z: 5 }, true);
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    let hit = false;
    for (let i = 0; i < 40 && !hit; i++) { a.step([{ ...REST_TOP, ax: 0, az: 0, dash: 1 }], REST_MECH); hit = a.drainEvents().some(e => e.k === 'hit' && e.section === 'rear'); }
    expect(hit).toBe(true);
    expect(a.mech.status.health).toBe(MECH.health - 1);
    expect(a.mech.status.hits.rear).toBe(1);
    expect(top.body.linvel().z).toBeGreaterThan(0);
    a.dispose();
  });

  it('does not damage the mech when a top only rests against it', () => {
    const a = new Arena(1, 0);
    const top = a.tops[0]!;
    top.body.setTranslation({ x: 0, y: bowlHeight(2.3) + TOP.radius, z: 2.3 }, true);
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    run(a, 2, [{ ...REST_TOP, mz: -0.15 }]);
    expect(a.mech.status.health).toBe(MECH.health);
    a.dispose();
  });

  it('slows and pushes the mech when a shadow hits it, but does not damage it', () => {
    const a = new Arena(0, 0);
    a.addShadow(0, 6, 0, -1, 0);
    let pushed = false;
    for (let i = 0; i < 90 && !pushed; i++) { a.step([], REST_MECH); pushed = a.drainEvents().some(e => e.k === 'shadowHit' && e.pushed); }
    expect(pushed).toBe(true);
    expect(a.mech.status.slows.length).toBe(1);
    expect(a.mech.status.health).toBe(MECH.health);
    run(a, 0.3);
    expect(a.mech.x).toBeLessThan(-0.5);
    a.dispose();
  });

  it('parry deletes shadows in the pulse and throws tops across the arena', () => {
    const a = new Arena(1, 0);
    const d = 3 / Math.SQRT2;
    a.tops[0]!.body.setTranslation({ x: d, y: surfaceHeight(d, d) + TOP.radius, z: d }, true);
    a.addShadow(0, -3, 0, 0, 1);
    a.addShadow(0, 2, -2, 1, 0);
    a.addShadow(0, -20, 0, 0, 1); // far away: survives
    run(a, 1 / 60, [{ ...REST_TOP, mx: -1, mz: -1 }], { ...REST_MECH, parry: 1 });
    expect(a.shadows).toHaveLength(1);
    expect(a.view().shadowEpoch).toBe(1);
    expect(a.drainEvents().filter(e => e.k === 'pop')).toHaveLength(2);
    // The player holds toward the mech, but the fling ignores input for a moment.
    run(a, 1.1, [{ ...REST_TOP, mx: -1, mz: -1 }]);
    const p = a.tops[0]!.body.translation();
    expect(rho(p.x, p.z)).toBeGreaterThan(ARENA.floorRadius);
    expect(a.mech.status.health).toBe(MECH.health);
    a.dispose();
  });

  it('deletes a shadow that touches the mech during the parry', () => {
    const a = new Arena(0, 0);
    run(a, 1 / 60, [], { ...REST_MECH, parry: 1 });
    a.addShadow(0, 0, -2.4, 0, 1);
    run(a, 0.1);
    expect(a.shadows).toHaveLength(0);
    expect(a.mech.status.slows).toHaveLength(0);
    a.dispose();
  });

  it('jumps toward the aim point, passes over shadows, and lands', () => {
    const a = new Arena(0, 0);
    a.addShadow(0, 0, -4, 0, 1);
    const jump: MechInput = { ...REST_MECH, ax: 0, az: 5, jump: 1 };
    run(a, 0.05, [], jump);
    expect(a.view().mech.air).toBe(true);
    expect(a.mech.status.slows).toHaveLength(0);
    for (let i = 0; i < 120 && a.view().mech.air; i++) a.step([], jump);
    expect(a.view().mech.air).toBe(false);
    expect(a.mech.z).toBeCloseTo(5, 0);
    a.dispose();
  });

  it('ends the round at zero health', () => {
    const a = new Arena(0, 0);
    a.mech.status.health = 1;
    a.mech.status.topImmuneUntil = -1;
    a.addShadow(0, 0, 0, 1, 0);
    run(a, 1);
    expect(a.over).toBe(false);
    a.mech.status.health = 0;
    a.step([], REST_MECH);
    expect(a.over).toBe(true);
    const t = a.clock;
    run(a, 1);
    expect(a.clock).toBe(t);
    a.dispose();
  });
});

describe('dash cooldown', () => {
  it('is 5.5 s times the number of tops', () => {
    for (const n of [1, 2, 3, 4]) { const a = new Arena(n, 0); expect(a.dashCooldown).toBeCloseTo(5.5 * n); expect(a.view().dashCooldown).toBeCloseTo(5.5 * n); a.dispose(); }
  });
  it('blocks a second dash until the scaled cooldown ends', () => {
    const a = new Arena(2, 0);
    run(a, 0.1, [{ ...REST_TOP, dash: 1 }]);
    run(a, 7, [{ ...REST_TOP, dash: 2 }]); // after 5.5 s, but before 11 s
    expect(a.tops[0]!.lastDash).toBe(2);
    expect(a.view().tops[0]!.dashCd).toBeGreaterThan(3);
    run(a, 4.2, [{ ...REST_TOP, dash: 2 }]);
    run(a, 0.05, [{ ...REST_TOP, dash: 3 }]);
    expect(a.view().tops[0]!.dashCd).toBeGreaterThan(10); // a press after 11 s starts a new dash
    a.dispose();
  });
});

describe('oval arena and half walls', () => {
  it('is wider than it is deep', () => {
    expect(ARENA.stretch).toBeGreaterThan(1.2);
    expect(surfaceHeight(ARENA.rimRadius * ARENA.stretch, 0)).toBeCloseTo(ARENA.rimHeight);
    expect(surfaceHeight(0, ARENA.rimRadius)).toBeCloseTo(ARENA.rimHeight);
  });
  it('spawns every top and the mech clear of the walls', () => {
    for (const n of [1, 2, 3, 4]) {
      const a = new Arena(n, 0);
      for (const t of a.tops) { const p = t.body.translation(); for (const w of a.walls) expect(pushOutOfWall(w, p.x, p.z, TOP.radius + 0.5)).toBeNull(); }
      for (const w of a.walls) expect(pushOutOfWall(w, 0, 0, MECH.radius + 0.5)).toBeNull();
      a.dispose();
    }
  });
  it('bounces a shadow off a wall', () => {
    const a = new Arena(0, 0);
    a.mech.x = -100;
    const w = wallBoxes()[1]!; // x = 9, along z
    a.addShadow(0, w.x - 4, w.z, 1, 0);
    run(a, 0.6);
    const p = a.shadows[0]!.body.translation();
    expect(p.x).toBeLessThan(w.x);
    expect(a.shadows[0]!.body.linvel().x).toBeLessThan(0);
    a.dispose();
  });
  it('ends a dash that runs into a wall', () => {
    const a = new Arena(1, 0);
    const w = wallBoxes()[1]!;
    const top = a.tops[0]!;
    top.body.setTranslation({ x: w.x - 3, y: surfaceHeight(w.x - 3, 0) + TOP.radius, z: 0 }, true);
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    run(a, 0.5, [{ ...REST_TOP, ax: 30, az: 0, dash: 1 }]);
    expect(top.body.translation().x).toBeLessThan(w.x);
    expect(a.view().tops[0]!.dashing).toBe(false);
    a.dispose();
  });
  it('blocks the mech on the ground, and the mech can jump over', () => {
    const a = new Arena(0, 0);
    const w = wallBoxes()[1]!;
    a.mech.x = w.x - 4; a.mech.z = 0;
    run(a, 2, [], { ...REST_MECH, mx: 1, ax: 30, az: 0 });
    expect(a.mech.x).toBeLessThanOrEqual(w.x - w.hz - MECH.radius + 0.01);
    run(a, 0.05, [], { ...REST_MECH, ax: w.x + 3, az: 0, jump: 1 });
    run(a, MECH.jumpTime + 0.2, [], { ...REST_MECH, ax: w.x + 3, az: 0, jump: 1 });
    expect(a.mech.x).toBeGreaterThan(w.x + w.hz + MECH.radius - 0.01);
    a.dispose();
  });
  it('never lands the mech inside a wall', () => {
    const a = new Arena(0, 0);
    const w = wallBoxes()[2]!; // along x at z = 7.5
    run(a, 0.05, [], { ...REST_MECH, ax: w.x, az: w.z, jump: 1 });
    run(a, MECH.jumpTime + 0.2, [], { ...REST_MECH, ax: w.x, az: w.z, jump: 1 });
    expect(pushOutOfWall(w, a.mech.x, a.mech.z, MECH.radius - 0.01)).toBeNull();
    a.dispose();
  });
});

describe('performance', () => {
  it('steps 500 shadows in under 4 ms', () => {
    const a = new Arena(4, 0);
    for (let i = 0; i < 500; i++) { const ang = i * 2.399; const r = 2 + (i % 11); a.addShadow(0, Math.cos(ang) * r, Math.sin(ang) * r, Math.sin(ang * 7), Math.cos(ang * 5)); }
    run(a, 1);
    const t0 = performance.now();
    run(a, 2);
    const ms = (performance.now() - t0) / 120;
    console.log(`500 shadows: ${ms.toFixed(2)} ms per step`);
    expect(ms).toBeLessThan(4);
    a.dispose();
  });
});
