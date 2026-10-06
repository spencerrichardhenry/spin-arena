import { beforeAll, describe, expect, it } from 'vitest';
import { Arena, initPhysics, REST_MECH, REST_TOP, type MechInput, type TopInput } from '../src/sim/arena.ts';
import { bowlHeight, rho, surfaceHeight } from '../src/sim/bowl.ts';
import { BUILDINGS, hitsBuilding, humpHeight, pushOutOfBox, pushOutOfTree, SPAWNS, TREES, TUNNEL, TUNNELS, tunnelLift, tunnelLocal, WALLS } from '../src/sim/city.ts';
import { ringAbility, type MechKit } from '../src/sim/rules.ts';
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
    const input: TopInput = { ...REST_TOP, mx: 1, ax: start.x - 30, az: start.z, dash: 1 }; // steering wins over the aim
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

  it('dashes the way the top already rolls when the player does not steer', () => {
    const a = new Arena(1, 0);
    const top = a.tops[0]!, p = top.body.translation();
    top.body.setLinvel({ x: 0, y: 0, z: 6 }, true);
    run(a, 0.1, [{ ...REST_TOP, ax: p.x + 30, az: p.z, dash: 1 }]);
    const v = top.body.linvel();
    expect(v.z).toBeGreaterThan(TOP.dashSpeed * 0.9);
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
    for (let i = 0; i < 40 && !hit; i++) { a.step([{ ...REST_TOP, mz: -1, dash: 1 }], REST_MECH); hit = a.drainEvents().some(e => e.k === 'hit' && e.section === 'rear'); }
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
    // 15° from +X: a clear line to the rim between the walls, tunnels and buildings.
    const tx = 3 * Math.cos(0.26), tz = 3 * Math.sin(0.26);
    a.tops[0]!.body.setTranslation({ x: tx, y: surfaceHeight(tx, tz) + TOP.radius, z: tz }, true);
    a.addShadow(0, -3, 0, 0, 1);
    a.addShadow(0, 2, -2, 1, 0);
    a.addShadow(0, 0, -15.5, 1, 0); // far away: survives
    run(a, 1 / 60, [{ ...REST_TOP, mx: -1, mz: -1 }], { ...REST_MECH, parry: 1 });
    expect(a.shadows).toHaveLength(1);
    expect(a.view().shadowEpoch).toBe(1);
    expect(a.drainEvents().filter(e => e.k === 'pop')).toHaveLength(2);
    // The player holds toward the mech, but the fling ignores input for a moment.
    let far = 0;
    for (let i = 0; i < 90; i++) { a.step([{ ...REST_TOP, mx: -1, mz: -1 }], REST_MECH); const p = a.tops[0]!.body.translation(); far = Math.max(far, Math.hypot(p.x - a.mech.x, p.z - a.mech.z)); }
    expect(far).toBeGreaterThan(25); // metres: most of the way across the floor
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
    const jump: MechInput = { ...REST_MECH, ax: 5, az: 0, jump: 1 };
    run(a, 0.05, [], jump);
    expect(a.view().mech.air).toBe(true);
    expect(a.mech.status.slows).toHaveLength(0);
    for (let i = 0; i < 120 && a.view().mech.air; i++) a.step([], jump);
    expect(a.view().mech.air).toBe(false);
    expect(a.mech.x).toBeCloseTo(5, 0);
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

describe('oval city arena', () => {
  it('is wider than it is deep', () => {
    expect(ARENA.stretch).toBeGreaterThan(1.2);
    expect(surfaceHeight(ARENA.rimRadius * ARENA.stretch, 0)).toBeCloseTo(ARENA.rimHeight);
    expect(surfaceHeight(0, ARENA.rimRadius)).toBeCloseTo(ARENA.rimHeight);
  });
  it('spawns every top and the mech clear of every obstacle', () => {
    const clear = (x: number, z: number, r: number) =>
      [...WALLS, ...BUILDINGS].every(b => !pushOutOfBox(b, x, z, r)) && TREES.every(t => !pushOutOfTree(t, x, z, r)) && tunnelLift(x, z) === 0;
    for (const [x, z] of SPAWNS) expect(clear(x, z, TOP.radius + 1)).toBe(true);
    expect(clear(0, 0, MECH.radius + 1)).toBe(true);
    for (const n of [1, 2, 3, 4]) { const a = new Arena(n, 0); expect(a.tops).toHaveLength(n); a.dispose(); }
  });
  it('keeps every obstacle on the floor, inside the rim', () => {
    for (const b of [...WALLS, ...BUILDINGS]) expect(rho(b.x, b.z) + Math.max(b.hx, b.hz) / ARENA.stretch).toBeLessThan(ARENA.floorRadius + 2);
    for (const t of TUNNELS) expect(rho(t.x, t.z)).toBeLessThan(ARENA.floorRadius - 2);
  });
  it('bounces a shadow off a half wall', () => {
    const a = new Arena(0, 0);
    a.mech.x = -100;
    const w = WALLS[1]!; // x = 8, along z
    a.addShadow(0, w.x - 4, w.z, 1, 0);
    run(a, 0.6);
    const p = a.shadows[0]!.body.translation();
    expect(p.x).toBeLessThan(w.x);
    expect(a.shadows[0]!.body.linvel().x).toBeLessThan(0);
    a.dispose();
  });
  it('ends a dash that runs into a wall', () => {
    const a = new Arena(1, 0);
    const w = WALLS[1]!;
    const top = a.tops[0]!;
    top.body.setTranslation({ x: w.x - 3, y: surfaceHeight(w.x - 3, 0) + TOP.radius, z: 0 }, true);
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    run(a, 0.5, [{ ...REST_TOP, mx: 1, dash: 1 }]);
    expect(top.body.translation().x).toBeLessThan(w.x);
    expect(a.view().tops[0]!.dashing).toBe(false);
    a.dispose();
  });
  it('blocks the mech at a half wall on the ground, and the mech can jump over', () => {
    const a = new Arena(0, 0);
    const w = WALLS[1]!;
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
    const w = WALLS[2]!; // along x at (-20, -7)
    a.mech.x = -14; a.mech.z = -6;
    run(a, 0.05, [], { ...REST_MECH, ax: w.x, az: w.z, jump: 1 });
    run(a, MECH.jumpTime + 0.2, [], { ...REST_MECH, ax: w.x, az: w.z, jump: 1 });
    expect(pushOutOfBox(w, a.mech.x, a.mech.z, MECH.radius - 0.01)).toBeNull();
    a.dispose();
  });
  it('stops a jump in front of a building', () => {
    const a = new Arena(0, 0);
    const b = BUILDINGS[1]!; // (12, -12)
    a.mech.x = 5; a.mech.z = -5;
    run(a, 0.05, [], { ...REST_MECH, ax: b.x, az: b.z, jump: 1 });
    run(a, MECH.jumpTime + 0.2, [], { ...REST_MECH, ax: b.x, az: b.z, jump: 1 });
    expect(hitsBuilding(a.mech.x, a.mech.z, MECH.radius - 0.01)).toBe(false);
    expect(a.mech.x).toBeGreaterThan(5.5);
    a.dispose();
  });
});

describe('tunnels', () => {
  const t = TUNNELS[0]!; // along x at (0, 10)
  it('lets a top roll through the passage', () => {
    const a = new Arena(1, 0);
    const top = a.tops[0]!;
    top.body.setTranslation({ x: t.x - 7, y: surfaceHeight(t.x - 7, t.z) + TOP.radius, z: t.z }, true);
    top.body.setLinvel({ x: 10, y: 0, z: 0 }, true);
    let maxY = -Infinity;
    for (let i = 0; i < 90; i++) { a.step([{ ...REST_TOP, mx: 1 }], REST_MECH); const p = top.body.translation(); if (Math.abs(p.x - t.x) < 2) maxY = Math.max(maxY, p.y - surfaceHeight(p.x, p.z)); }
    const p = top.body.translation();
    expect(p.x).toBeGreaterThan(t.x + TUNNEL.length / 2);
    expect(Math.abs(p.z - t.z)).toBeLessThan(TUNNEL.inner.halfWidth);
    expect(maxY).toBeLessThan(TUNNEL.inner.height); // it went under the roof
    a.dispose();
  });
  it('lets a fast top go over the roof', () => {
    const a = new Arena(1, 0);
    const top = a.tops[0]!;
    top.body.setTranslation({ x: t.x + 2.5, y: surfaceHeight(t.x + 2.5, t.z - 7) + TOP.radius, z: t.z - 7 }, true);
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    let maxY = -Infinity, crossed = false;
    for (let i = 0; i < 60; i++) {
      a.step([{ ...REST_TOP, mz: 1, dash: 1 }], REST_MECH);
      const p = top.body.translation();
      if (Math.abs(p.z - t.z) < 1) maxY = Math.max(maxY, p.y - surfaceHeight(p.x, p.z));
      if (p.z > t.z + 5) crossed = true;
    }
    expect(crossed).toBe(true);
    expect(maxY).toBeGreaterThan(TUNNEL.outer[1]![1]!);
    a.dispose();
  });
  it('starts a shadow at the height where its dash started, not under a ramp', () => {
    const a = new Arena(1, 0);
    const top = a.tops[0]!;
    // A top resting on the ramp, 3 m across from the passage, dashes along the tunnel.
    const v = -3, x = t.x, z = t.z + v;
    const ramp = surfaceHeight(x, z) + humpHeight(v);
    top.body.setTranslation({ x, y: ramp + TOP.radius + 0.05, z }, true);
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    run(a, SHADOW.delay + 0.1, [{ ...REST_TOP, mx: 1, dash: 1 }]);
    expect(a.shadows).toHaveLength(1);
    const p = a.shadows[0]!.body.translation(), local = tunnelLocal(t, p.x, p.z);
    const under = Math.abs(local.u) < TUNNEL.length / 2 && Math.abs(local.v) > TUNNEL.inner.halfWidth &&
      p.y - surfaceHeight(p.x, p.z) < humpHeight(local.v);
    expect(under).toBe(false);
    a.dispose();
  });
  it('pushes a ball that is inside a ramp back out', () => {
    const a = new Arena(0, 0);
    a.mech.x = -30; a.mech.z = -18;
    const x = t.x + 1, z = t.z - 3;
    a.addShadow(0, x, z, 1, 0);
    a.shadows[0]!.body.setTranslation({ x, y: surfaceHeight(x, z) + SHADOW.radius, z }, true);
    run(a, 3);
    const p = a.shadows[0]!.body.translation(), local = tunnelLocal(t, p.x, p.z);
    const under = Math.abs(local.u) < TUNNEL.length / 2 && Math.abs(local.v) > TUNNEL.inner.halfWidth &&
      p.y - surfaceHeight(p.x, p.z) < humpHeight(local.v) - SHADOW.radius;
    expect(under).toBe(false);
    a.dispose();
  });
  it('blocks a walking mech at a tunnel; a jump lands on the roof, and walking off drops it', () => {
    const a = new Arena(0, 0);
    a.mech.x = t.x; a.mech.z = t.z - 8;
    run(a, 2, [], { ...REST_MECH, mz: 1 });
    const edge = t.z + TUNNEL.outer[0]![0]!; // the ramp foot nearest the mech
    expect(a.mech.z).toBeLessThanOrEqual(edge - MECH.radius + 0.01);
    run(a, 1 / 60, [], { ...REST_MECH, ax: t.x, az: t.z, jump: 1 });
    run(a, MECH.jumpTime + 0.5, [], { ...REST_MECH, ax: t.x, az: t.z, jump: 1 });
    const height = () => a.mech.body.translation().y - surfaceHeight(a.mech.x, a.mech.z) - MECH.height / 2;
    expect(Math.abs(a.mech.z - t.z)).toBeLessThan(1);
    expect(height()).toBeGreaterThan(TUNNEL.outer[1]![1]! - 0.1);
    // Walk off the end of the roof, along the passage.
    run(a, 2, [], { ...REST_MECH, mx: 1, jump: 1 });
    expect(a.mech.x).toBeGreaterThan(t.x + TUNNEL.length / 2);
    run(a, 0.5, [], { ...REST_MECH, jump: 1 });
    expect(height()).toBeLessThan(0.05);
    a.dispose();
  });
  it('turns the mech to face its movement at once', () => {
    const a = new Arena(0, 0);
    run(a, 1 / 60, [], { ...REST_MECH, mx: 1 });
    expect(a.mech.yaw).toBeCloseTo(Math.PI / 2);
    run(a, 1 / 60, [], { ...REST_MECH, mz: -1 });
    expect(Math.abs(a.mech.yaw)).toBeCloseTo(Math.PI);
    run(a, 0.2, [], REST_MECH); // no input: keeps facing
    expect(Math.abs(a.mech.yaw)).toBeCloseTo(Math.PI);
    a.dispose();
  });
});

describe('mech kits', () => {
  const kit = (k: Partial<MechKit>): MechKit => ({ move: 'boost', air: 'jump', guard: 'parry', ...k });
  it('blinks toward the mouse, up to its range, and not into a building', () => {
    const a = new Arena(0, 0, kit({ move: 'blink' }));
    run(a, 1 / 60, [], { ...REST_MECH, ax: -20, az: -20, boost: 1 });
    expect(Math.hypot(a.mech.x, a.mech.z)).toBeCloseTo(MECH.blinkRange, 0);
    expect(a.drainEvents().some(e => e.k === 'blink')).toBe(true);
    const b = new Arena(0, 0, kit({ move: 'blink' }));
    b.mech.x = 7; b.mech.z = -6;
    run(b, 1 / 60, [], { ...REST_MECH, ax: 14, az: -14, boost: 1 });
    expect(hitsBuilding(b.mech.x, b.mech.z, MECH.radius - 0.01)).toBe(false);
    a.dispose(); b.dispose();
  });
  it('hovers while held, above tops and walls, and lands when the fuel runs out', () => {
    const a = new Arena(1, 0, kit({ air: 'hover' }));
    const held: MechInput = { ...REST_MECH, ax: 0, az: 5, jump: 1, airHeld: true };
    run(a, 0.6, [], held);
    expect(a.airborne).toBe(true);
    // A top rammed into it now does nothing.
    const top = a.tops[0]!;
    top.body.setTranslation({ x: 0, y: surfaceHeight(0, 3) + TOP.radius, z: 3 }, true);
    top.body.setLinvel({ x: 0, y: 0, z: -20 }, true);
    run(a, 0.3, [], held);
    expect(a.mech.status.health).toBe(MECH.health);
    run(a, MECH.hoverFuel, [], held);
    expect(a.view().mech.hover).toBe(false);
    run(a, 1, [], held);
    expect(a.airborne).toBe(false);
    expect(a.view().mech.cd.air).toBeGreaterThan(0);
    a.dispose();
  });
  it('stops hovering when the key is released', () => {
    const a = new Arena(0, 0, kit({ air: 'hover' }));
    run(a, 0.5, [], { ...REST_MECH, jump: 1, airHeld: true });
    expect(a.view().mech.hover).toBe(true);
    run(a, 1 / 60, [], { ...REST_MECH, jump: 1, airHeld: false });
    expect(a.view().mech.hover).toBe(false);
    a.dispose();
  });
  it('shield blocks hits from every side and deletes every shadow that touches it', () => {
    const a = new Arena(1, 0, kit({ guard: 'shield' }));
    run(a, 1 / 60, [], { ...REST_MECH, ax: 0, az: -10, parry: 1 }); // mech faces −Z (yaw π)
    const top = a.tops[0]!;
    top.body.setTranslation({ x: 0, y: surfaceHeight(0, 5) + TOP.radius, z: 5 }, true); // behind the mech
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    let blocked = false;
    for (let i = 0; i < 40 && !blocked; i++) { a.step([{ ...REST_TOP, mz: -1, dash: 1 }], { ...REST_MECH, ax: 0, az: -10, parry: 1 }); blocked = a.drainEvents().some(e => e.k === 'block'); }
    expect(blocked).toBe(true);
    expect(a.mech.status.health).toBe(MECH.health);
    a.addShadow(0, 0, 4, 0, -1); // from behind
    run(a, 0.3, [], { ...REST_MECH, ax: 0, az: -10, parry: 1 });
    expect(a.shadows).toHaveLength(0);
    expect(a.mech.status.slows).toHaveLength(0);
    expect(MECH.shieldTime).toBe(5);
    a.dispose();
  });
});

describe('top abilities (from the ring)', () => {
  const behind = (a: Arena) => {
    // Mech faces −Z (yaw π); put the top behind it (+Z), at rest.
    const top = a.tops[0]!;
    top.body.setTranslation({ x: 0, y: bowlHeight(5) + TOP.radius, z: 5 }, true);
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    return top;
  };
  it('maps each ring design to its ability', () => {
    expect([0, 1, 2, 3].map(ringAbility)).toEqual(['empower', 'whirlpool', 'dash', 'leap']);
  });
  it('empower makes the next hit within 3 s do double damage, then wears off', () => {
    const a = new Arena(1, 0, undefined, ['empower']);
    behind(a);
    run(a, 1 / 60, [{ ...REST_TOP, dash: 1 }]);
    expect(a.view().tops[0]!.empowered).toBe(true);
    // Roll in fast enough to count as a hit.
    a.tops[0]!.body.setLinvel({ x: 0, y: 0, z: -12 }, true);
    let dmg = 0;
    for (let i = 0; i < 40 && !dmg; i++) { a.step([{ ...REST_TOP, mz: -1, dash: 1 }], REST_MECH); for (const e of a.drainEvents()) if (e.k === 'hit') dmg = e.damage; }
    expect(dmg).toBe(2);
    expect(a.mech.status.health).toBe(MECH.health - 2);
    expect(a.mech.status.hits.rear).toBe(2);
    expect(a.view().tops[0]!.empowered).toBe(false);
    a.dispose();
  });
  it('empower runs out after its time', () => {
    const a = new Arena(1, 0, undefined, ['empower']);
    run(a, 1 / 60, [{ ...REST_TOP, dash: 1 }]);
    run(a, TOP.empowerTime + 0.1, [{ ...REST_TOP, dash: 1 }]);
    expect(a.view().tops[0]!.empowered).toBe(false);
    a.dispose();
  });
  it('whirlpool pulls the mech in and slows it for a while', () => {
    const a = new Arena(1, 0, undefined, ['whirlpool']);
    a.tops[0]!.body.setTranslation({ x: 4, y: bowlHeight(4) + TOP.radius, z: 0 }, true);
    a.tops[0]!.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    run(a, 1 / 60, [{ ...REST_TOP, dash: 1 }]);
    expect(a.view().vortices).toHaveLength(1);
    run(a, 0.5, [{ ...REST_TOP, dash: 1 }]);
    expect(a.mech.x).toBeGreaterThan(1); // pulled toward x = 4
    run(a, TOP.whirlpoolTime, [{ ...REST_TOP, dash: 1 }]);
    expect(a.view().vortices).toHaveLength(0);
    a.dispose();
  });
  it('leap jumps the top over a half wall', () => {
    const a = new Arena(1, 0, undefined, ['leap']);
    const w = WALLS[1]!; // x = 8, along z
    const top = a.tops[0]!;
    top.body.setTranslation({ x: w.x - 3, y: surfaceHeight(w.x - 3, 0) + TOP.radius, z: 0 }, true);
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    run(a, 1, [{ ...REST_TOP, mx: 1, dash: 1 }]);
    expect(top.body.translation().x).toBeGreaterThan(w.x + w.hz);
    a.dispose();
  });
  it('every ability leaves a shadow', () => {
    for (const ability of ['empower', 'whirlpool', 'leap'] as const) {
      const a = new Arena(1, 0, undefined, [ability]);
      run(a, SHADOW.delay + 0.1, [{ ...REST_TOP, mx: 1, dash: 1 }]);
      expect(a.shadows).toHaveLength(1);
      a.dispose();
    }
  });
});

describe('more mech options', () => {
  const kit = (k: Partial<MechKit>): MechKit => ({ move: 'boost', air: 'jump', guard: 'parry', ...k });
  it('phase teleports through a building and lands clear of it', () => {
    const b = BUILDINGS[1]!; // (12, -12), 6 × 7
    const a = new Arena(0, 0, kit({ move: 'phase' }));
    a.mech.x = b.x - b.hx - MECH.radius - 0.2; a.mech.z = b.z; // just west of it
    run(a, 1 / 60, [], { ...REST_MECH, ax: b.x + 30, az: b.z, boost: 1 });
    expect(a.mech.x).toBeGreaterThan(b.x + b.hx); // now east of it
    expect(hitsBuilding(a.mech.x, a.mech.z, MECH.radius - 0.01)).toBe(false);
    a.dispose();
  });
  it('cloak hides the mech for a while', () => {
    const a = new Arena(0, 0, kit({ air: 'cloak' }));
    run(a, 1 / 60, [], { ...REST_MECH, jump: 1 });
    expect(a.view().mech.cloak).toBe(true);
    run(a, MECH.cloakTime + 0.1, [], { ...REST_MECH, jump: 1 });
    expect(a.view().mech.cloak).toBe(false);
    a.dispose();
  });
  it('lock freezes every top on the map, far away and behind the mech too', () => {
    const a = new Arena(2, 0, kit({ guard: 'lock' }));
    const [near, far] = a.tops;
    near!.body.setTranslation({ x: 0, y: bowlHeight(5) + TOP.radius, z: -5 }, true); // in front (mech faces −Z)
    far!.body.setTranslation({ x: -25, y: surfaceHeight(-25, 14) + TOP.radius, z: 14 }, true); // far behind
    for (const t of [near!, far!]) t.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    run(a, 1 / 60, [], { ...REST_MECH, parry: 1 });
    expect(a.view().tops.map(t => t.locked)).toEqual([true, true]);
    const p0 = { ...near!.body.translation() };
    run(a, 1, [{ ...REST_TOP, mx: 1, dash: 1 }], { ...REST_MECH, parry: 1 });
    const p1 = near!.body.translation();
    expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeLessThan(0.2);
    expect(a.shadows.length + (a as unknown as { pending: unknown[] }).pending.length).toBe(0); // no ability while locked
    run(a, MECH.lockTime, [{ ...REST_TOP, mx: 1, dash: 1 }], { ...REST_MECH, parry: 1 });
    expect(a.view().tops[0]!.locked).toBe(false);
    a.dispose();
  });
  it('lock starts its cooldown even with no tops', () => {
    const a = new Arena(0, 0, kit({ guard: 'lock' }));
    run(a, 1 / 60, [], { ...REST_MECH, parry: 1 });
    expect(a.view().mech.cd.guard).toBeCloseTo(MECH.lockCooldown, 1);
    expect(MECH.lockCooldown).toBe(10);
    a.dispose();
  });
  it('parry stuns the tops it throws: no steering and no ability until the stun ends', () => {
    // Same throw twice, once with steering: the stunned top must end up in the same place.
    const play = (mx: number) => {
      const a = new Arena(1, 0);
      const top = a.tops[0]!;
      top.body.setTranslation({ x: 0, y: bowlHeight(4) + TOP.radius, z: 4 }, true);
      top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      run(a, 1 / 60, [], { ...REST_MECH, parry: 1 });
      expect(a.view().tops[0]!.stunned).toBe(true);
      run(a, 1.5, [{ ...REST_TOP, mx, dash: 1 }], { ...REST_MECH, parry: 1 });
      const p = { ...top.body.translation() }, v = a.view().tops[0]!;
      a.dispose();
      return { p, v };
    };
    const still = play(0), steered = play(1);
    expect(steered.p.x).toBeCloseTo(still.p.x, 3);
    expect(steered.p.z).toBeCloseTo(still.p.z, 3);
    expect(steered.v.dashCd).toBe(0); // the press during the stun did nothing
    expect(steered.v.stunned).toBe(true);
    const a = new Arena(1, 0);
    a.tops[0]!.body.setTranslation({ x: 0, y: bowlHeight(4) + TOP.radius, z: 4 }, true);
    run(a, 1 / 60, [], { ...REST_MECH, parry: 1 });
    run(a, MECH.parryStun + 0.05, [], { ...REST_MECH, parry: 1 }); // a little past the end: the clock is a sum of float steps
    expect(a.view().tops[0]!.stunned).toBe(false);
    run(a, 1 / 60, [{ ...REST_TOP, dash: 1 }], { ...REST_MECH, parry: 1 });
    expect(a.view().tops[0]!.dashCd).toBeGreaterThan(0); // works again
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
    // 4 ms is the budget on a development computer; shared CI machines are about twice as slow.
    expect(ms).toBeLessThan(import.meta.env.CI ? 12 : 4);
    a.dispose();
  });
});

describe('round start', () => {
  it('ignores presses from an earlier round and from the countdown', () => {
    const a = new Arena(1, 1, { move: 'boost', air: 'cloak', guard: 'shield' });
    // Counters carried over from the round before.
    const old: MechInput = { ...REST_MECH, boost: 4, jump: 3, parry: 2 };
    run(a, 0.5, [{ ...REST_TOP, dash: 5 }], old);
    // One more press of each during the countdown, held through GO.
    const early: MechInput = { ...old, boost: 5, jump: 4, parry: 3 };
    run(a, 0.7, [{ ...REST_TOP, dash: 6 }], early);
    expect(a.clock).toBeGreaterThan(0);
    const kinds = a.drainEvents().map(e => e.k);
    for (const k of ['boost', 'cloak', 'shield', 'dash']) expect(kinds).not.toContain(k);
    expect(a.view().mech.cd).toEqual({ move: 0, air: 0, guard: 0 });
    expect(a.view().tops[0]!.dashCd).toBe(0);
    // A press after GO still works.
    run(a, 1 / 60, [{ ...REST_TOP, dash: 7 }], { ...early, boost: 6 });
    expect(a.drainEvents().map(e => e.k)).toEqual(expect.arrayContaining(['boost', 'dash']));
    a.dispose();
  });
});
