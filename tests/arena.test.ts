import { beforeAll, describe, expect, it } from 'vitest';
import { Arena, initPhysics, REST_MECH, REST_TOP, type MechInput, type TopInput } from '../src/sim/arena.ts';
import { bowlHeight } from '../src/sim/bowl.ts';
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
      expect(Math.hypot(p.x, p.z)).toBeLessThan(ARENA.rimRadius + 0.1);
      expect(p.y).toBeGreaterThan(-0.5);
      expect(speedXZ(sh.body.linvel())).toBeCloseTo(SHADOW.speed, 1);
    }
    a.dispose();
  });

  it('keeps tops in the arena when they drive into the rim', () => {
    const a = new Arena(1, 0);
    run(a, 8, [{ ...REST_TOP, mx: 1, mz: 0.2, ax: 50, az: 0, dash: 1 }]);
    const p = a.tops[0]!.body.translation();
    expect(Math.hypot(p.x, p.z)).toBeLessThan(ARENA.rimRadius);
    a.dispose();
  });

  it('damages the section a fast top strikes, and bounces the top', () => {
    const a = new Arena(1, 0);
    const top = a.tops[0]!;
    // Mech faces -Z (yaw π). Place the top behind it (+Z) and dash forward.
    top.body.setTranslation({ x: 0, y: bowlHeight(6) + TOP.radius, z: 6 }, true);
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    run(a, 0.6, [{ ...REST_TOP, ax: 0, az: 0, dash: 1 }]);
    expect(a.mech.status.health).toBe(MECH.health - 1);
    expect(a.mech.status.hits.rear).toBe(1);
    const events = a.drainEvents();
    expect(events.some(e => e.k === 'hit' && e.section === 'rear')).toBe(true);
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

  it('flings nearby tops and shadows with the parry pulse and ignores hits during it', () => {
    const a = new Arena(1, 0);
    a.tops[0]!.body.setTranslation({ x: 3, y: bowlHeight(3) + TOP.radius, z: 0 }, true);
    a.addShadow(0, -3, 0, 0, 1);
    run(a, 1 / 60, [], { ...REST_MECH, parry: 1 });
    run(a, 0.5);
    expect(Math.hypot(a.tops[0]!.body.translation().x, a.tops[0]!.body.translation().z)).toBeGreaterThan(8);
    expect(Math.hypot(a.shadows[0]!.body.translation().x, a.shadows[0]!.body.translation().z)).toBeGreaterThan(8);
    expect(a.mech.status.health).toBe(MECH.health);
    expect(a.mech.status.slows).toHaveLength(0);
    a.dispose();
  });

  it('jumps toward the aim point, passes over shadows, and lands', () => {
    const a = new Arena(0, 0);
    a.addShadow(0, 0, -4, 0, 1);
    const jump: MechInput = { ...REST_MECH, ax: 0, az: 8, jump: 1 };
    run(a, 0.05, [], jump);
    expect(a.view().mech.air).toBe(true);
    expect(a.mech.status.slows).toHaveLength(0);
    run(a, MECH.jumpTime + 0.1, [], jump);
    expect(a.view().mech.air).toBe(false);
    expect(a.mech.z).toBeCloseTo(8, 0);
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
