import RAPIER from '@dimforge/rapier3d-compat';
import { ARENA, FALL, HAZARD, MATCH, MECH, SHADOW, TOP } from '../tuning.ts';
import { activeFloor, bowlMesh, clampInside, clampMech, onFloor, surfaceHeight, wallMesh } from './bowl.ts';
import {
  beltAt, BUILDINGS, BUMPERS, hitsBuilding, MAP, POSTS, pushOutOfBox, pushOutOfCircle, RIM, SAWS, sawPosition, setMap, SPAWNS, TREE, TREES,
  TUNNEL_BOXES, TUNNELS, tunnelLift, tunnelSolids, WALLS,
} from './city.ts';
import type { MapId } from './maps.ts';
import {
  activeSlows, applySawHit, applyShadowHit, applyTopHit, baseSpeed, blinkRange, boostFactor, cloakTime, createMechStatus, dead, DEFAULT_KIT,
  hasControl, hitSection, hoverFuel, jumpRange, lockTime, parryRadius, phaseRange, shieldTime, slowFactor,
  type MechKit, type MechStatus, type Section, type TopAbility,
} from './rules.ts';

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> { return (ready ??= RAPIER.init()); }

/**
 * Movement is a unit-or-shorter vector. The mech faces the way it moves. Aim is a world point: the target of
 * a jump or blink (clients put it ahead of the character), and a top's dash direction when it neither moves
 * nor rolls. Button values count presses, so a fast tap is never lost. For the mech, `boost`, `jump` and
 * `parry` are the presses for the legs, back and arms slots (whatever the kit puts there); `airHeld` is true
 * while the back-slot key is held (for hover).
 */
export interface TopInput { mx: number; mz: number; ax: number; az: number; dash: number }
export interface MechInput { mx: number; mz: number; ax: number; az: number; boost: number; jump: number; parry: number; airHeld: boolean }
export const REST_TOP: TopInput = { mx: 0, mz: 0, ax: 0, az: 0, dash: 0 };
export const REST_MECH: MechInput = { mx: 0, mz: 0, ax: 0, az: 1, boost: 0, jump: 0, parry: 0, airHeld: false };

export type GameEvent =
  | { k: 'hit'; top: number; section: Section; x: number; z: number; damage: number }
  | { k: 'empower'; top: number }
  | { k: 'whirlpool'; top: number; x: number; z: number }
  | { k: 'leap'; top: number }
  | { k: 'lock'; top: number }
  | { k: 'cloak' }
  | { k: 'phase'; fx: number; fz: number; tx: number; tz: number }
  | { k: 'block'; x: number; z: number }
  | { k: 'shadowHit'; pushed: boolean; x: number; z: number }
  | { k: 'pop'; x: number; z: number }
  | { k: 'dash'; top: number }
  | { k: 'shadow'; top: number }
  | { k: 'parry'; radius: number }
  | { k: 'shield' }
  | { k: 'blink'; fx: number; fz: number; tx: number; tz: number }
  | { k: 'hover' }
  | { k: 'jump' }
  | { k: 'land' }
  | { k: 'boost' }
  | { k: 'saw'; x: number; z: number }
  | { k: 'bump'; top: number; x: number; z: number }
  | { k: 'fall'; top: number }
  | { k: 'respawn'; top: number }
  | { k: 'over'; time: number };

// Collision groups: upper 16 bits are membership, lower 16 bits are the filter.
const G_ARENA = 1, G_TOP = 2, G_SHADOW = 4, G_MECH = 8;
const groups = (member: number, filter: number) => (member << 16) | filter;
const ARENA_GROUPS = groups(G_ARENA, 0xffff);
const TOP_GROUPS = groups(G_TOP, G_ARENA | G_TOP | G_MECH);
const SHADOW_GROUPS = groups(G_SHADOW, G_ARENA | G_MECH);
const MECH_GROUPS = groups(G_MECH, G_TOP | G_SHADOW);
const MECH_AIR_GROUPS = groups(G_MECH, 0);
/** Above this height the mech passes over tops, shadows, half walls and tunnels. */
const AIR_CLEARANCE = 2;

interface Top {
  body: RAPIER.RigidBody;
  lastDash: number;
  dashUntil: number;
  dashReadyAt: number;
  dirX: number; dirZ: number;
  spin: number;
  flungUntil: number;
  ability: TopAbility;
  cooldown: number;
  empoweredUntil: number;
  lockedUntil: number;
  stunnedUntil: number;
  /** −1 while in play; after a fall, the time it respawns. */
  outUntil: number;
}
interface Vortex { x: number; z: number; until: number }
interface Shadow { body: RAPIER.RigidBody; owner: number; lastHit: number }
interface PendingShadow { at: number; owner: number; x: number; y: number; z: number; dx: number; dz: number }
interface Jump { fx: number; fz: number; tx: number; tz: number; start: number }
interface Mech {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  kit: MechKit;
  x: number; z: number; yaw: number;
  vx: number; vz: number;
  pushX: number; pushZ: number;
  /** Height above the floor: `ground` follows a tunnel roof the mech stands on, `lift` is from jumps and hover. */
  ground: number; lift: number; onTunnel: boolean;
  last: { boost: number; jump: number; parry: number };
  moveUntil: number; moveReadyAt: number;
  jump: Jump | null; hovering: boolean; hoverFuel: number; airReadyAt: number;
  guardUntil: number; guardReadyAt: number;
  cloakUntil: number;
  status: MechStatus;
}

export interface TopView {
  x: number; y: number; z: number; spin: number; dashing: boolean;
  ability: TopAbility;
  /** Seconds left on the ability's cooldown, and its full cooldown this round. */
  dashCd: number; cdMax: number;
  empowered: boolean; locked: boolean; stunned: boolean;
  /** True while the top has fallen off and waits to respawn. */
  out: boolean;
}
export interface MechView {
  x: number; y: number; z: number; yaw: number; kit: MechKit;
  /** True while nothing on the ground can touch the mech. */
  air: boolean; hover: boolean; parry: boolean; shield: boolean; boost: boolean; control: boolean;
  health: number; hits: Record<Section, number>; slows: number;
  /** Seconds left on each slot's cooldown, and each slot's full cooldown. */
  cd: { move: number; air: number; guard: number };
  cdMax: { move: number; air: number; guard: number };
  /** 0 when a slot's power is gone (its section is broken). */
  power: { move: number; air: number; guard: number };
  /** Hover fuel from 0 to 1. */
  fuel: number;
  /** True while the tops cannot see the mech. */
  cloak: boolean;
}
export interface ArenaView {
  clock: number; over: boolean; tops: TopView[]; mech: MechView; shadows: number;
  /** Dash cooldown for this round (it grows with the number of tops). */
  dashCooldown: number;
  /** Counts shadow removals, so a guest does not interpolate between two different shadow lists. */
  shadowEpoch: number;
  /** Active whirlpools and the seconds each has left. */
  vortices: { x: number; z: number; t: number }[];
}

const DT = 1 / MATCH.tickRate;
const hyp = Math.hypot;
/** Highest a ball may climb above the rim before it must fall back. */
const RIM_CLEARANCE = 1.2;

/**
 * Keeps a ball inside the arena: a speed up the steep rim (or into a flat map's rim) must not carry it out.
 * A top on an open map may leave the floor and fall; a shadow never does.
 */
function contain(body: RAPIER.RigidBody, radius: number, restitution: number, canFall: boolean): void {
  const p = body.translation(), v = body.linvel(), floor = activeFloor();
  let { x, y, z } = p, { x: vx, y: vy, z: vz } = v, changed = false;
  const falls = canFall && floor.kind === 'flat' && floor.open;
  const out = falls ? null : clampInside(p.x, p.z, radius);
  if (out) {
    x = out.x; z = out.z;
    const along = vx * out.nx + vz * out.nz;
    if (along > 0) { vx -= (1 + restitution) * along * out.nx; vz -= (1 + restitution) * along * out.nz; }
    changed = true;
  }
  if (floor.kind === 'bowl' && y > ARENA.rimHeight + RIM_CLEARANCE && vy > 0) { vy = 0; changed = true; }
  // A ball that sinks a little into the floor comes back up; one that fell past an open edge keeps falling.
  const ground = surfaceHeight(x, z);
  if (onFloor(x, z) && y < ground - radius && (!falls || y > ground - radius - 1)) { y = ground + radius; vy = Math.max(0, vy); changed = true; }
  if (!changed) return;
  body.setTranslation({ x, y, z }, true);
  body.setLinvel({ x: vx, y: vy, z: vz }, true);
}

export class Arena {
  readonly world: RAPIER.World;
  /** Seconds since the round started; negative during the countdown. */
  clock = -MATCH.countdown;
  over = false;
  readonly tops: Top[] = [];
  readonly shadows: Shadow[] = [];
  readonly mech: Mech;
  readonly dashCooldown: number;
  /** Ability cooldowns are multiplied by the number of tops. */
  private readonly cooldownScale: number;
  private vortices: Vortex[] = [];
  private readonly hasBelts: boolean;
  shadowEpoch = 0;
  private pending: PendingShadow[] = [];
  events: GameEvent[] = [];

  /** `abilities` gives each top's ability (from its ring); missing entries are dash. */
  constructor(topCount: number, countdown = MATCH.countdown, kit: MechKit = DEFAULT_KIT, abilities: readonly TopAbility[] = [], map: MapId = 'city') {
    setMap(map);
    this.hasBelts = MAP.belts.length > 0;
    this.clock = -countdown;
    this.world = new RAPIER.World({ x: 0, y: -ARENA.gravity, z: 0 });
    this.world.timestep = DT;
    const solid = (desc: RAPIER.ColliderDesc, restitution: number, rule: RAPIER.CoefficientCombineRule) =>
      this.world.createCollider(desc.setFriction(0).setRestitution(restitution).setRestitutionCombineRule(rule).setCollisionGroups(ARENA_GROUPS));
    const floor = activeFloor();
    if (floor.kind === 'bowl') {
      const bowl = bowlMesh();
      solid(RAPIER.ColliderDesc.trimesh(bowl.vertices, bowl.indices), 0, RAPIER.CoefficientCombineRule.Min);
      const rim = wallMesh();
      solid(RAPIER.ColliderDesc.trimesh(rim.vertices, rim.indices), 1, RAPIER.CoefficientCombineRule.Max);
    } else {
      // A slab under the outline, 2 m deep.
      const pts: number[] = [];
      for (const [x, z] of floor.outline) pts.push(x, 0, z, x, -2, z);
      const slab = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
      if (!slab) throw new Error('The map floor has no convex hull.');
      solid(slab, 0, RAPIER.CoefficientCombineRule.Min);
    }
    for (const w of [...WALLS, ...BUILDINGS, ...RIM]) {
      // Rapier's rotation about +Y turns +X toward −Z, so the layout angle is negated.
      solid(RAPIER.ColliderDesc.cuboid(w.hx, w.hy, w.hz).setTranslation(w.x, w.y, w.z)
        .setRotation({ x: 0, y: Math.sin(-w.angle / 2), z: 0, w: Math.cos(-w.angle / 2) }), 1, RAPIER.CoefficientCombineRule.Max);
    }
    for (const t of TUNNELS) for (const points of tunnelSolids(t)) {
      const hull = RAPIER.ColliderDesc.convexHull(points);
      if (!hull) throw new Error('A tunnel block has no convex hull.');
      // Ramps must not bounce, so tops can roll over them.
      solid(hull, 0, RAPIER.CoefficientCombineRule.Min);
    }
    for (const t of TREES) {
      solid(RAPIER.ColliderDesc.cylinder(TREE.trunkHeight / 2, TREE.trunk).setTranslation(t.x, t.base + TREE.trunkHeight / 2, t.z), 1, RAPIER.CoefficientCombineRule.Max);
    }
    for (const b of BUMPERS) {
      solid(RAPIER.ColliderDesc.cylinder(0.5, HAZARD.bumperRadius).setTranslation(b.x, 0.5, b.z), 1, RAPIER.CoefficientCombineRule.Max);
    }

    this.cooldownScale = Math.max(1, topCount);
    this.dashCooldown = TOP.dashCooldown * this.cooldownScale;
    for (let i = 0; i < topCount; i++) { const [x, z] = SPAWNS[i % SPAWNS.length]!; this.addTop(x, z, abilities[i] ?? 'dash'); }
    const [sx, sz] = MAP.mechStart;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(sx, surfaceHeight(sx, sz) + MECH.height / 2, sz));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cylinder(MECH.height / 2, MECH.radius)
      .setRestitution(1).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max).setFriction(0).setCollisionGroups(MECH_GROUPS), body);
    this.mech = {
      body, collider, kit: { ...kit }, x: sx, z: sz, yaw: Math.PI, vx: 0, vz: 0, pushX: 0, pushZ: 0, ground: 0, lift: 0, onTunnel: false,
      last: { boost: 0, jump: 0, parry: 0 },
      moveUntil: -1, moveReadyAt: 0, jump: null, hovering: false, hoverFuel: 0, airReadyAt: 0, guardUntil: -1, guardReadyAt: 0, cloakUntil: -1,
      status: createMechStatus(),
    };
  }

  /** A ball at (x, z). Without a height it sits on the floor. */
  private ball(x: number, z: number, radius: number, member: number, restitution: number, y = surfaceHeight(x, z) + radius + 0.02): RAPIER.RigidBody {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z).lockRotations().setCcdEnabled(true)
      .setLinearDamping(member === G_TOP ? TOP.damping : 0));
    this.world.createCollider(RAPIER.ColliderDesc.ball(radius).setFriction(0).setRestitution(restitution)
      .setCollisionGroups(member === G_TOP ? TOP_GROUPS : SHADOW_GROUPS), body);
    return body;
  }
  private addTop(x: number, z: number, ability: TopAbility): void {
    const base = { dash: TOP.dashCooldown, empower: TOP.empowerCooldown, whirlpool: TOP.whirlpoolCooldown, leap: TOP.leapCooldown }[ability];
    this.tops.push({
      body: this.ball(x, z, TOP.radius, G_TOP, TOP.restitution), lastDash: 0, dashUntil: -1, dashReadyAt: 0, dirX: 0, dirZ: 1, spin: 0, flungUntil: -1,
      ability, cooldown: base * this.cooldownScale, empoweredUntil: -1, lockedUntil: -1, stunnedUntil: -1, outUntil: -1,
    });
  }
  /**
   * Adds a shadow; used by the dash replay and by tests. `y` is the height where the dash started:
   * a dash from a tunnel ramp or roof must not leave its shadow on the floor under it.
   */
  addShadow(owner: number, x: number, z: number, dx: number, dz: number, y?: number): void {
    const body = this.ball(x, z, SHADOW.radius, G_SHADOW, 1, y);
    const len = hyp(dx, dz) || 1;
    body.setLinvel({ x: (dx / len) * SHADOW.speed, y: 0, z: (dz / len) * SHADOW.speed }, true);
    this.shadows.push({ body, owner, lastHit: -99 });
    this.events.push({ k: 'shadow', top: owner });
  }

  /** Advances one fixed step. Inputs for missing tops are treated as rest. */
  step(tops: readonly TopInput[], mech: MechInput): void {
    if (this.over) return;
    this.clock += DT;
    if (this.clock < 0) { this.holdPresses(tops, mech); return; }
    const now = this.clock;
    this.stepTops(tops, now);
    this.applyBelts(now);
    this.stepMech(mech, now);
    while (this.pending.length && this.pending[0]!.at <= now) {
      const p = this.pending.shift()!;
      this.addShadow(p.owner, p.x, p.z, p.dx, p.dz, p.y);
    }
    const before = this.tops.map(t => t.body.linvel());
    this.world.step();
    this.endBlockedDashes();
    this.keepShadowSpeed();
    for (const t of this.tops) if (t.outUntil < 0) contain(t.body, TOP.radius, TOP.restitution, true);
    for (const sh of this.shadows) contain(sh.body, SHADOW.radius, 1, false);
    this.applyBumpers();
    this.applySaws(now);
    this.dropFallen(now);
    this.resolveHits(before, now);
    if (dead(this.mech.status)) { this.over = true; this.events.push({ k: 'over', time: now }); }
  }

  /**
   * During the countdown, presses only update the counters. Controls count presses for the whole session,
   * so without this every counter that is not 0 would look like a new press at GO.
   */
  private holdPresses(tops: readonly TopInput[], mech: MechInput): void {
    this.tops.forEach((t, i) => { const input = tops[i]; if (input) t.lastDash = input.dash; });
    this.mech.last = { boost: mech.boost, jump: mech.jump, parry: mech.parry };
  }

  private stepTops(inputs: readonly TopInput[], now: number): void {
    this.tops.forEach((top, i) => {
      const input = inputs[i] ?? REST_TOP;
      // A fallen top waits; presses made meanwhile are used up.
      if (top.outUntil >= 0) { top.lastDash = input.dash; return; }
      const v = top.body.linvel();
      top.spin += TOP.spinRate * DT;
      if (input.dash !== top.lastDash) {
        top.lastDash = input.dash;
        if (now >= top.dashReadyAt && now >= top.lockedUntil && now >= top.stunnedUntil) this.useAbility(top, i, input, now);
      }
      if (now < top.lockedUntil) { top.body.setLinvel({ x: 0, y: Math.min(0, v.y), z: 0 }, true); return; }
      if (now < top.dashUntil) {
        top.body.setLinvel({ x: top.dirX * TOP.dashSpeed, y: v.y, z: top.dirZ * TOP.dashSpeed }, true);
        return;
      }
      if (now < top.flungUntil || now < top.stunnedUntil) return;
      const len = hyp(input.mx, input.mz);
      const mx = len > 1 ? input.mx / len : input.mx, mz = len > 1 ? input.mz / len : input.mz;
      let nx = v.x + mx * TOP.accel * DT, nz = v.z + mz * TOP.accel * DT;
      const old = hyp(v.x, v.z), next = hyp(nx, nz);
      // Input cannot push past max speed, but bounces and dashes may exceed it and fade by damping.
      if (next > TOP.maxSpeed && next > old) { const cap = Math.max(old, TOP.maxSpeed) / next; nx *= cap; nz *= cap; }
      top.body.setLinvel({ x: nx, y: v.y, z: nz }, true);
    });
  }

  /** A top below the void line is out. After FALL.respawnTime it comes back, still, at the spawn farthest from the mech. */
  private dropFallen(now: number): void {
    this.tops.forEach((top, i) => {
      if (top.outUntil >= 0) {
        if (now < top.outUntil) return;
        top.outUntil = -1;
        const m = this.mech, far = (s: [number, number]) => hyp(s[0] - m.x, s[1] - m.z);
        const [x, z] = SPAWNS.reduce((best, s) => (far(s) > far(best) ? s : best));
        top.body.setEnabled(true);
        top.body.setTranslation({ x, y: surfaceHeight(x, z) + TOP.radius + 0.02, z }, true);
        top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.events.push({ k: 'respawn', top: i });
        return;
      }
      if (top.body.translation().y > FALL.outY) return;
      top.outUntil = now + FALL.respawnTime;
      top.dashUntil = top.flungUntil = top.lockedUntil = top.stunnedUntil = top.empoweredUntil = -1;
      top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      top.body.setEnabled(false);
      this.events.push({ k: 'fall', top: i });
    });
  }

  /**
   * A top's ability (set by its ring). Every ability, like the dash, leaves a shadow that replays the top's
   * direction from where it was used, so every round still fills up with shadows.
   */
  private useAbility(top: Top, i: number, input: TopInput, now: number): void {
    const p = top.body.translation(), v = top.body.linvel();
    // The way the player steers; otherwise the way the top already rolls; otherwise toward the aim.
    let dx = input.mx, dz = input.mz, len = hyp(dx, dz);
    if (len < 0.2) { dx = v.x; dz = v.z; len = hyp(dx, dz); if (len < 1) len = 0; }
    if (len < 0.1) { dx = input.ax - p.x; dz = input.az - p.z; len = hyp(dx, dz); }
    if (len < 0.1) { dx = 0; dz = -1; len = 1; }
    top.dirX = dx / len; top.dirZ = dz / len;
    top.dashReadyAt = now + top.cooldown;
    this.pending.push({ at: now + SHADOW.delay, owner: i, x: p.x, y: p.y, z: p.z, dx: top.dirX, dz: top.dirZ });
    switch (top.ability) {
      case 'dash':
        top.dashUntil = now + TOP.dashTime;
        this.events.push({ k: 'dash', top: i });
        break;
      case 'empower':
        top.empoweredUntil = now + TOP.empowerTime;
        this.events.push({ k: 'empower', top: i });
        break;
      case 'whirlpool':
        this.vortices.push({ x: p.x, z: p.z, until: now + TOP.whirlpoolTime });
        this.events.push({ k: 'whirlpool', top: i, x: p.x, z: p.z });
        break;
      case 'leap':
        top.flungUntil = now + 0.5;
        top.body.setLinvel({ x: top.dirX * TOP.leapSpeed, y: TOP.leapUp, z: top.dirZ * TOP.leapSpeed }, true);
        this.events.push({ k: 'leap', top: i });
        break;
    }
  }

  // ---------- Hazards ----------

  /** Belts push a rolling top along them, up to HAZARD.beltTopSpeed. A top in the air or locked is not moved. */
  private applyBelts(now: number): void {
    if (!this.hasBelts) return;
    for (const top of this.tops) {
      if (top.outUntil >= 0 || now < top.lockedUntil) continue;
      const p = top.body.translation();
      if (p.y > surfaceHeight(p.x, p.z) + TOP.radius + 0.4) continue;
      const belt = beltAt(p.x, p.z);
      if (!belt) continue;
      const v = top.body.linvel(), along = v.x * belt.dx + v.z * belt.dz;
      if (along >= HAZARD.beltTopSpeed) continue;
      const add = Math.min(HAZARD.beltAccel * DT, HAZARD.beltTopSpeed - along);
      top.body.setLinvel({ x: v.x + belt.dx * add, y: v.y, z: v.z + belt.dz * add }, true);
    }
  }

  /** A top that touches a bumper leaves it at HAZARD.bumperKick or more. Shadows bounce off its collider. */
  private applyBumpers(): void {
    for (const b of BUMPERS) this.tops.forEach((top, i) => {
      if (top.outUntil >= 0) return;
      const p = top.body.translation(), dx = p.x - b.x, dz = p.z - b.z, d = hyp(dx, dz);
      if (d > HAZARD.bumperRadius + TOP.radius + 0.15 || d < 0.01) return;
      const v = top.body.linvel(), nx = dx / d, nz = dz / d, out = v.x * nx + v.z * nz;
      if (out >= HAZARD.bumperKick) return;
      top.dashUntil = -1;
      const add = HAZARD.bumperKick - out;
      top.body.setLinvel({ x: v.x + add * nx, y: v.y, z: v.z + add * nz }, true);
      this.events.push({ k: 'bump', top: i, x: b.x, z: b.z });
    });
  }

  /** Saws throw tops away and push the mech (no damage). They do not touch shadows. */
  private applySaws(now: number): void {
    const m = this.mech;
    for (const saw of SAWS) {
      const c = sawPosition(saw, now);
      for (const top of this.tops) {
        if (top.outUntil >= 0 || now < top.flungUntil) continue;
        const p = top.body.translation(), dx = p.x - c.x, dz = p.z - c.z, d = hyp(dx, dz);
        if (d > HAZARD.sawRadius + TOP.radius || p.y > surfaceHeight(p.x, p.z) + 1.5) continue;
        const nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0;
        top.dashUntil = -1; top.flungUntil = now + 0.5;
        top.body.setLinvel({ x: nx * HAZARD.sawThrow, y: 3, z: nz * HAZARD.sawThrow }, true);
        this.events.push({ k: 'saw', x: p.x, z: p.z });
      }
      if (this.airborne) continue;
      const dx = m.x - c.x, dz = m.z - c.z, d = hyp(dx, dz);
      if (d > HAZARD.sawRadius + MECH.radius || !applySawHit(m.status, now).pushed) continue;
      const nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0;
      m.pushX = nx * MECH.pushSpeed; m.pushZ = nz * MECH.pushSpeed; m.vx = m.vz = 0; m.moveUntil = -1; m.hovering = false;
      this.events.push({ k: 'saw', x: m.x, z: m.z });
    }
  }

  // ---------- Mech ----------

  /** True while the mech is high enough to pass over everything except buildings. */
  get airborne(): boolean { return !!this.mech.jump || (this.mech.hovering && this.mech.lift > AIR_CLEARANCE); }

  private setAir(air: boolean): void { this.mech.collider.setCollisionGroups(air ? MECH_AIR_GROUPS : MECH_GROUPS); }

  private stepMech(input: MechInput, now: number): void {
    const m = this.mech, s = m.status;
    // A mech on a tunnel follows its roof; walking off the edge drops it to the floor.
    if (m.onTunnel && tunnelLift(m.x, m.z) <= 0) m.onTunnel = false;
    const roof = m.onTunnel ? tunnelLift(m.x, m.z) : 0;
    m.ground += Math.max(-MECH.climbRate * DT, Math.min(MECH.climbRate * DT, roof - m.ground));
    if (m.jump) { this.stepJump(now); return; }
    const control = hasControl(s, now);
    if (control) {
      if (hyp(input.mx, input.mz) > 0.2) m.yaw = Math.atan2(input.mx, input.mz);
      if (input.boost !== m.last.boost) { m.last.boost = input.boost; this.useMove(input, now); }
      if (input.parry !== m.last.parry) { m.last.parry = input.parry; this.useGuard(now); }
      if (input.jump !== m.last.jump) {
        m.last.jump = input.jump;
        if (this.useAir(input, now)) return;
      }
    } else {
      // Consume presses made while stunned so they do not fire afterwards.
      m.last = { boost: input.boost, jump: input.jump, parry: input.parry };
    }
    this.stepHover(input, now, control);
    // Whirlpools pull a mech on the ground toward their centres and slow it.
    this.vortices = this.vortices.filter(v => v.until > now);
    let pullX = 0, pullZ = 0, swirl = 1;
    if (!this.airborne) for (const v of this.vortices) {
      const dx = v.x - m.x, dz = v.z - m.z, d = hyp(dx, dz);
      if (d >= TOP.whirlpoolRadius) continue;
      swirl = TOP.whirlpoolSlow;
      if (d > 0.3) { pullX += (dx / d) * TOP.whirlpoolPull; pullZ += (dz / d) * TOP.whirlpoolPull; }
    }
    let wx = 0, wz = 0;
    const boosting = m.kit.move === 'boost' && now < m.moveUntil;
    if (control) {
      const len = hyp(input.mx, input.mz);
      if (len > 0.01) {
        const speed = baseSpeed(s) * slowFactor(s, now) * swirl * (boosting ? boostFactor(s) : 1) * (m.hovering ? MECH.hoverSpeedFactor : 1);
        wx = (input.mx / Math.max(1, len)) * speed; wz = (input.mz / Math.max(1, len)) * speed;
      }
    }
    const k = boosting ? 1 : Math.min(1, (MECH.accel * DT) / Math.max(0.01, hyp(wx - m.vx, wz - m.vz)));
    m.vx += (wx - m.vx) * k;
    m.vz += (wz - m.vz) * k;
    const decay = Math.exp(-MECH.pushDecay * DT);
    m.pushX *= decay; m.pushZ *= decay;
    // A belt carries the mech on the ground (not on a tunnel roof or in the air).
    const belt = this.airborne || m.onTunnel ? null : beltAt(m.x, m.z);
    const bx = belt ? belt.dx * HAZARD.beltMechSpeed : 0, bz = belt ? belt.dz * HAZARD.beltMechSpeed : 0;
    m.x += (m.vx + m.pushX + pullX + bx) * DT; m.z += (m.vz + m.pushZ + pullZ + bz) * DT;
    this.keepMechInside(!this.airborne);
    this.placeMech();
  }

  /** Legs slot: boost, blink (stops at buildings) or phase (passes through anything). Both teleports aim at (ax, az). */
  private useMove(input: MechInput, now: number): void {
    const m = this.mech, s = m.status;
    if (now < m.moveReadyAt) return;
    if (m.kit.move === 'phase') {
      const range = phaseRange(s);
      if (range <= 0) return;
      const to = this.phaseTarget(input.ax, input.az, range);
      this.events.push({ k: 'phase', fx: m.x, fz: m.z, tx: to.x, tz: to.z });
      m.x = to.x; m.z = to.z; m.vx = m.vz = 0;
      m.moveReadyAt = now + MECH.phaseCooldown;
      this.settle();
      return;
    }
    if (m.kit.move === 'boost') {
      if (boostFactor(s) <= 0) return;
      m.moveUntil = now + MECH.boostTime; m.moveReadyAt = now + MECH.boostCooldown;
      this.events.push({ k: 'boost' });
      return;
    }
    const range = blinkRange(s);
    if (range <= 0) return;
    const to = this.traceTo(input.ax, input.az, range);
    this.events.push({ k: 'blink', fx: m.x, fz: m.z, tx: to.x, tz: to.z });
    m.x = to.x; m.z = to.z; m.vx = m.vz = 0;
    m.moveReadyAt = now + MECH.blinkCooldown;
    this.settle();
  }

  /** Arms slot: parry pulse, the front shield, or lock (freeze the nearest top in front). */
  private useGuard(now: number): void {
    const m = this.mech, s = m.status;
    if (now < m.guardReadyAt) return;
    if (m.kit.guard === 'lock') {
      const time = lockTime(s);
      if (time <= 0) return;
      // Lock reaches every top on the map, at any distance and in any direction.
      this.tops.forEach((t, i) => {
        if (t.outUntil >= 0) return;
        t.lockedUntil = now + time; t.dashUntil = -1; t.flungUntil = -1;
        this.events.push({ k: 'lock', top: i });
      });
      m.guardUntil = now + 0.2; m.guardReadyAt = now + MECH.lockCooldown;
      return;
    }
    if (m.kit.guard === 'parry') {
      const radius = parryRadius(s);
      if (radius <= 0) return;
      m.guardUntil = now + MECH.parryActive; m.guardReadyAt = now + MECH.parryCooldown;
      this.pulse(radius, now);
      this.events.push({ k: 'parry', radius });
      return;
    }
    const time = shieldTime(s);
    if (time <= 0) return;
    m.guardUntil = now + time; m.guardReadyAt = now + MECH.shieldCooldown;
    this.events.push({ k: 'shield' });
  }

  /** Back slot: jump (returns true when it starts), begin to hover, or cloak. */
  private useAir(input: MechInput, now: number): boolean {
    const m = this.mech, s = m.status;
    if (now < m.airReadyAt || m.hovering) return false;
    if (m.kit.air === 'cloak') {
      const time = cloakTime(s);
      if (time <= 0) return false;
      m.cloakUntil = now + time; m.airReadyAt = now + MECH.cloakCooldown;
      this.events.push({ k: 'cloak' });
      return false;
    }
    if (m.kit.air === 'hover') {
      const fuel = hoverFuel(s);
      if (fuel <= 0) return false;
      m.hovering = true; m.hoverFuel = fuel;
      this.events.push({ k: 'hover' });
      return false;
    }
    const range = jumpRange(s);
    if (range <= 0) return false;
    const to = this.traceTo(input.ax, input.az, range);
    m.jump = { fx: m.x, fz: m.z, tx: to.x, tz: to.z, start: now };
    m.airReadyAt = now + MECH.jumpCooldown;
    m.vx = m.vz = m.pushX = m.pushZ = 0;
    this.setAir(true);
    this.events.push({ k: 'jump' });
    this.placeMech();
    return true;
  }

  /**
   * The farthest point toward (ax, az), up to `range`, that a jump or blink can reach: it stops in front of
   * the first building and inside the arena. Half walls, tunnels and trees do not stop it.
   */
  private traceTo(ax: number, az: number, range: number): { x: number; z: number } {
    const m = this.mech;
    let dx = ax - m.x, dz = az - m.z;
    const len = hyp(dx, dz);
    if (len < 0.01) return { x: m.x, z: m.z };
    const dist = Math.min(range, len);
    dx /= len; dz /= len;
    let best = { x: m.x, z: m.z };
    for (let d = 0.25; d <= dist + 1e-6; d += 0.25) {
      const x = m.x + dx * d, z = m.z + dz * d;
      if (hitsBuilding(x, z, MECH.radius)) break;
      best = { x, z };
    }
    const edge = clampMech(best.x, best.z);
    return edge ? { x: edge.x, z: edge.z } : best;
  }

  private stepJump(now: number): void {
    const m = this.mech, j = m.jump!;
    const t = Math.min(1, (now - j.start) / MECH.jumpTime);
    m.x = j.fx + (j.tx - j.fx) * t;
    m.z = j.fz + (j.tz - j.fz) * t;
    m.lift = 4 * MECH.jumpHeight * t * (1 - t);
    if (t >= 1) {
      m.jump = null; m.lift = 0;
      this.setAir(false);
      this.events.push({ k: 'land' });
      this.settle();
    }
    this.placeMech();
  }

  private stepHover(input: MechInput, now: number, control: boolean): void {
    const m = this.mech;
    const was = this.airborne;
    if (m.hovering) {
      m.hoverFuel -= DT;
      if (!input.airHeld || !control || m.hoverFuel <= 0) {
        m.hovering = false; m.airReadyAt = now + MECH.hoverCooldown;
        // Coming down over a tunnel lands on its roof.
        if (tunnelLift(m.x, m.z) > 0) { m.onTunnel = true; m.ground = Math.max(m.ground, Math.min(m.lift, tunnelLift(m.x, m.z))); }
      }
    }
    const target = m.hovering ? MECH.hoverHeight : 0;
    const rate = (m.hovering ? 8 : 10) * DT;
    const lifted = m.lift > 0;
    m.lift += Math.max(-rate, Math.min(rate, target - m.lift));
    if (lifted && m.lift <= 0 && !m.hovering) { this.events.push({ k: 'land' }); this.settle(); }
    if (this.airborne !== was) this.setAir(this.airborne);
  }

  /**
   * Where a phase lands: `range` toward (ax, az), through walls and buildings. If that spot is blocked, the
   * nearest free spot a little farther along the line, else back toward the start.
   */
  private phaseTarget(ax: number, az: number, range: number): { x: number; z: number } {
    const m = this.mech;
    let dx = ax - m.x, dz = az - m.z;
    const len = hyp(dx, dz) || 1;
    dx /= len; dz /= len;
    const at = (d: number) => ({ x: m.x + dx * d, z: m.z + dz * d });
    for (let d = range; d <= range + 4; d += 0.25) { const p = at(d); if (this.isFree(p.x, p.z)) return p; }
    for (let d = range; d > 0; d -= 0.25) { const p = at(d); if (this.isFree(p.x, p.z)) return p; }
    return { x: m.x, z: m.z };
  }

  /** True when the mech could stand at (x, z): inside the arena and clear of every obstacle (tunnel roofs count as free). */
  private isFree(x: number, z: number): boolean {
    if (clampMech(x, z)) return false;
    if ([...BUILDINGS, ...WALLS].some(b => pushOutOfBox(b, x, z, MECH.radius))) return false;
    if (POSTS.some(p => pushOutOfCircle(p.x, p.z, p.r, x, z, MECH.radius))) return false;
    return tunnelLift(x, z) > 0 || !TUNNEL_BOXES.some(b => pushOutOfBox(b, x, z, MECH.radius));
  }

  /** After a jump, blink or hover: land on a tunnel roof when over one, otherwise keep clear of obstacles. */
  private settle(): void {
    const m = this.mech, roof = tunnelLift(m.x, m.z);
    if (roof > 0) { m.onTunnel = true; m.ground = roof; }
    this.keepMechInside(true);
  }

  /**
   * Keeps the mech inside the oval and out of buildings. On the ground it also stays out of half walls, trunks
   * and tunnels, unless it stands on a tunnel's roof.
   */
  private keepMechInside(onGround: boolean): void {
    const m = this.mech;
    const boxes = onGround ? [...BUILDINGS, ...WALLS, ...(m.onTunnel ? [] : TUNNEL_BOXES)] : BUILDINGS;
    const posts = onGround ? POSTS : [];
    // Two obstacles can push the mech back and forth, so repeat the push-out a few times.
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      const edge = clampMech(m.x, m.z);
      if (edge) { m.x = edge.x; m.z = edge.z; this.blockMech(edge.nx, edge.nz); moved = true; }
      for (const b of boxes) {
        const hit = pushOutOfBox(b, m.x, m.z, MECH.radius);
        // The push normal points away from the box; movement into the box is along its reverse.
        if (hit) { m.x = hit.x; m.z = hit.z; this.blockMech(-hit.nx, -hit.nz); moved = true; }
      }
      for (const p of posts) {
        const hit = pushOutOfCircle(p.x, p.z, p.r, m.x, m.z, MECH.radius);
        if (hit) { m.x = hit.x; m.z = hit.z; this.blockMech(-hit.nx, -hit.nz); moved = true; }
      }
      if (!moved) return;
    }
    // Still wedged in a gap narrower than the mech (only after a landing): move to the nearest free spot.
    const free = (x: number, z: number) => !clampMech(x, z) &&
      boxes.every(b => !pushOutOfBox(b, x, z, MECH.radius)) && posts.every(p => !pushOutOfCircle(p.x, p.z, p.r, x, z, MECH.radius));
    if (free(m.x, m.z)) return;
    for (let r = 0.5; r <= 8; r += 0.5) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, x = m.x + Math.cos(a) * r, z = m.z + Math.sin(a) * r;
      if (free(x, z)) { m.x = x; m.z = z; m.vx = m.vz = m.pushX = m.pushZ = 0; return; }
    }
  }

  /** Removes velocity along n (the direction into a blocking surface); a knock-back bounces off it instead. */
  private blockMech(nx: number, nz: number): void {
    const m = this.mech;
    const out = m.vx * nx + m.vz * nz; if (out > 0) { m.vx -= out * nx; m.vz -= out * nz; }
    const pout = m.pushX * nx + m.pushZ * nz; if (pout > 0) { m.pushX -= 2 * pout * nx; m.pushZ -= 2 * pout * nz; }
  }

  private placeMech(): void {
    const m = this.mech;
    m.body.setNextKinematicTranslation({ x: m.x, y: surfaceHeight(m.x, m.z) + MECH.height / 2 + Math.max(m.ground, m.lift), z: m.z });
  }

  private mechY(): number { return this.mech.body.translation().y; }

  // ---------- Parry, shield and hits ----------

  /** Parry pulse: fling every top in the radius across the arena, and delete every shadow in it. */
  private pulse(radius: number, now: number): void {
    const m = this.mech, reach = radius + MECH.radius;
    for (const top of this.tops) {
      const p = top.body.translation();
      if (top.outUntil < 0 && hyp(p.x - m.x, p.z - m.z) <= reach) this.fling(top, now, MECH.parryTopSpeed, MECH.parryStun);
    }
    this.removeShadows(sh => { const p = sh.body.translation(); return hyp(p.x - m.x, p.z - m.z) <= reach; });
  }

  private fling(top: Top, now: number, speed: number, stun = 0): void {
    const m = this.mech, p = top.body.translation();
    const dx = p.x - m.x, dz = p.z - m.z, d = hyp(dx, dz);
    const nx = d > 0.01 ? dx / d : 0, nz = d > 0.01 ? dz / d : 1;
    top.dashUntil = -1;
    top.flungUntil = now + MECH.parryFlingTime;
    if (stun > 0) top.stunnedUntil = Math.max(top.stunnedUntil, now + stun);
    top.body.setLinvel({ x: nx * speed, y: 4, z: nz * speed }, true);
  }

  private removeShadows(test: (sh: Shadow) => boolean): void {
    let removed = 0;
    for (let i = this.shadows.length - 1; i >= 0; i--) {
      const sh = this.shadows[i]!;
      if (!test(sh)) continue;
      const p = sh.body.translation();
      this.events.push({ k: 'pop', x: p.x, z: p.z });
      this.world.removeRigidBody(sh.body);
      this.shadows.splice(i, 1);
      removed++;
    }
    if (removed) this.shadowEpoch++;
  }

  /** True while the shield is up. It covers the mech all around. */
  private shielded(now: number): boolean { return this.mech.kit.guard === 'shield' && now < this.mech.guardUntil; }

  /** A dash stops when something blocks it (a wall, another top), instead of grinding into it. */
  private endBlockedDashes(): void {
    for (const top of this.tops) {
      if (top.dashUntil < 0) continue;
      const v = top.body.linvel();
      if (v.x * top.dirX + v.z * top.dirZ < TOP.dashSpeed * 0.5) top.dashUntil = -1;
    }
  }

  /** Shadows never lose energy: restore their horizontal speed after every step. */
  private keepShadowSpeed(): void {
    for (const sh of this.shadows) {
      const v = sh.body.linvel();
      const h = hyp(v.x, v.z);
      if (h < 0.05) {
        // Stalled (for example at the top of the rim): send it back toward the centre.
        const p = sh.body.translation(), r = hyp(p.x, p.z) || 1;
        sh.body.setLinvel({ x: (-p.x / r) * SHADOW.speed, y: v.y, z: (-p.z / r) * SHADOW.speed }, true);
      } else sh.body.setLinvel({ x: (v.x / h) * SHADOW.speed, y: v.y, z: (v.z / h) * SHADOW.speed }, true);
    }
  }

  private resolveHits(before: { x: number; y: number; z: number }[], now: number): void {
    const m = this.mech, s = m.status;
    if (this.airborne) return;
    const my = this.mechY(), parrying = m.kit.guard === 'parry' && now < m.guardUntil;
    const reach = (r: number) => MECH.radius + r + 0.25;
    this.tops.forEach((top, i) => {
      if (top.outUntil >= 0) return;
      const p = top.body.translation(), dx = p.x - m.x, dz = p.z - m.z, d = hyp(dx, dz);
      if (d > reach(TOP.radius) || Math.abs(p.y - my) > MECH.height / 2 + TOP.radius) return;
      const nx = d > 0.01 ? dx / d : 0, nz = d > 0.01 ? dz / d : 1;
      if (parrying) { if (now >= top.flungUntil) this.fling(top, now, MECH.parryTopSpeed, MECH.parryStun); return; }
      const v = before[i]!;
      const closing = -((v.x - m.vx) * nx + (v.z - m.vz) * nz);
      if (closing < MECH.minHitSpeed) return;
      if (this.shielded(now)) {
        this.fling(top, now, MECH.shieldBounce);
        this.events.push({ k: 'block', x: p.x, z: p.z });
        return;
      }
      const section = hitSection(m.yaw, dx, dz);
      const damage = now < top.empoweredUntil ? 2 : 1;
      if (applyTopHit(s, section, now, damage)) {
        top.empoweredUntil = -1;
        this.events.push({ k: 'hit', top: i, section, x: p.x, z: p.z, damage });
      }
      top.dashUntil = -1;
      top.body.setLinvel({ x: nx * MECH.topBounce, y: 2, z: nz * MECH.topBounce }, true);
    });
    const touching = (sh: Shadow) => {
      const p = sh.body.translation();
      return hyp(p.x - m.x, p.z - m.z) <= reach(SHADOW.radius) && Math.abs(p.y - my) <= MECH.height / 2 + SHADOW.radius;
    };
    // During the parry or the shield, a shadow that touches the mech is deleted.
    if (parrying || this.shielded(now)) { this.removeShadows(touching); return; }
    for (const sh of this.shadows) {
      if (now - sh.lastHit < SHADOW.rehitTime || !touching(sh)) continue;
      const p = sh.body.translation(), dx = p.x - m.x, dz = p.z - m.z, d = hyp(dx, dz);
      const nx = d > 0.01 ? dx / d : 0, nz = d > 0.01 ? dz / d : 1;
      sh.lastHit = now;
      const { pushed } = applyShadowHit(s, now);
      if (pushed) { m.pushX = -nx * MECH.pushSpeed; m.pushZ = -nz * MECH.pushSpeed; m.vx = m.vz = 0; m.moveUntil = -1; m.hovering = false; }
      // Send the shadow away so it does not stay against the mech.
      const v = sh.body.linvel();
      if (v.x * nx + v.z * nz < 0) sh.body.setLinvel({ x: nx * SHADOW.speed, y: v.y, z: nz * SHADOW.speed }, true);
      this.events.push({ k: 'shadowHit', pushed, x: p.x, z: p.z });
    }
  }

  /** Takes and clears the events since the last call. */
  drainEvents(): GameEvent[] { const e = this.events; this.events = []; return e; }

  view(): ArenaView {
    const now = Math.max(0, this.clock), m = this.mech, s = m.status, p = m.body.translation(), kit = m.kit;
    const fuel = hoverFuel(s);
    return {
      clock: this.clock,
      over: this.over,
      tops: this.tops.map(t => {
        const q = t.body.translation();
        return {
          x: q.x, y: q.y, z: q.z, spin: t.spin, dashing: now < t.dashUntil, ability: t.ability,
          dashCd: Math.max(0, t.dashReadyAt - now), cdMax: t.cooldown, empowered: now < t.empoweredUntil, locked: now < t.lockedUntil, stunned: now < t.stunnedUntil, out: t.outUntil >= 0,
        };
      }),
      mech: {
        x: p.x, y: p.y, z: p.z, yaw: m.yaw, kit: { ...kit },
        air: this.airborne, hover: m.hovering, parry: kit.guard === 'parry' && now < m.guardUntil, shield: kit.guard === 'shield' && now < m.guardUntil,
        boost: kit.move === 'boost' && now < m.moveUntil, control: hasControl(s, now),
        health: s.health, hits: { ...s.hits }, slows: activeSlows(s, now),
        cd: { move: Math.max(0, m.moveReadyAt - now), air: Math.max(0, m.airReadyAt - now), guard: Math.max(0, m.guardReadyAt - now) },
        cdMax: {
          move: { boost: MECH.boostCooldown, blink: MECH.blinkCooldown, phase: MECH.phaseCooldown }[kit.move],
          air: { jump: MECH.jumpCooldown, hover: MECH.hoverCooldown, cloak: MECH.cloakCooldown }[kit.air],
          guard: { parry: MECH.parryCooldown, shield: MECH.shieldCooldown, lock: MECH.lockCooldown }[kit.guard],
        },
        power: {
          move: { boost: boostFactor(s), blink: blinkRange(s), phase: phaseRange(s) }[kit.move],
          air: { jump: jumpRange(s), hover: fuel, cloak: cloakTime(s) }[kit.air],
          guard: { parry: parryRadius(s), shield: shieldTime(s), lock: lockTime(s) }[kit.guard],
        },
        fuel: m.hovering && fuel > 0 ? Math.max(0, m.hoverFuel / fuel) : 1,
        cloak: now < m.cloakUntil,
      },
      shadows: this.shadows.length,
      dashCooldown: this.dashCooldown,
      shadowEpoch: this.shadowEpoch,
      vortices: this.vortices.map(v => ({ x: v.x, z: v.z, t: Math.max(0, v.until - now) })),
    };
  }

  /** Shadow positions as x, y, z triples. */
  shadowPositions(out: Float32Array = new Float32Array(this.shadows.length * 3)): Float32Array {
    this.shadows.forEach((sh, i) => { const p = sh.body.translation(); out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z; });
    return out;
  }

  /** Current survival time in seconds. */
  get survival(): number { return Math.max(0, this.clock); }

  dispose(): void { this.world.free(); }
}
