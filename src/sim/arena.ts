import RAPIER from '@dimforge/rapier3d-compat';
import { ARENA, MATCH, MECH, SHADOW, TOP } from '../tuning.ts';
import { bowlMesh, clampOval, surfaceHeight, wallMesh } from './bowl.ts';
import {
  BUILDINGS, hitsBuilding, pushOutOfBox, pushOutOfTree, SPAWNS, TREE, TREES, TUNNELS, tunnelLift, tunnelMesh, WALLS,
} from './city.ts';
import {
  activeSlows, applyShadowHit, applyTopHit, baseSpeed, blinkRange, boostFactor, createMechStatus, dead, DEFAULT_KIT,
  forward, hasControl, hitSection, hoverFuel, jumpRange, parryRadius, shieldTime, slowFactor,
  type MechKit, type MechStatus, type Section,
} from './rules.ts';

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> { return (ready ??= RAPIER.init()); }

/**
 * Movement is a unit-or-shorter vector; aim is a world point. Button values count presses, so a fast tap
 * is never lost. For the mech, `boost`, `jump` and `parry` are the presses for the legs, back and arms
 * slots (whatever the kit puts there); `airHeld` is true while the back-slot key is held (for hover).
 */
export interface TopInput { mx: number; mz: number; ax: number; az: number; dash: number }
export interface MechInput { mx: number; mz: number; ax: number; az: number; boost: number; jump: number; parry: number; airHeld: boolean }
export const REST_TOP: TopInput = { mx: 0, mz: 0, ax: 0, az: 0, dash: 0 };
export const REST_MECH: MechInput = { mx: 0, mz: 0, ax: 0, az: 1, boost: 0, jump: 0, parry: 0, airHeld: false };

export type GameEvent =
  | { k: 'hit'; top: number; section: Section; x: number; z: number }
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
}
interface Shadow { body: RAPIER.RigidBody; owner: number; lastHit: number }
interface PendingShadow { at: number; owner: number; x: number; z: number; dx: number; dz: number }
interface Jump { fx: number; fz: number; tx: number; tz: number; start: number }
interface Mech {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  kit: MechKit;
  x: number; z: number; yaw: number;
  vx: number; vz: number;
  pushX: number; pushZ: number;
  /** Height above the floor: `ground` follows tunnel roofs, `lift` is from jumps and hover. */
  ground: number; lift: number;
  last: { boost: number; jump: number; parry: number };
  moveUntil: number; moveReadyAt: number;
  jump: Jump | null; hovering: boolean; hoverFuel: number; airReadyAt: number;
  guardUntil: number; guardReadyAt: number;
  status: MechStatus;
}

export interface TopView { x: number; y: number; z: number; spin: number; dashing: boolean; dashCd: number }
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
}
export interface ArenaView {
  clock: number; over: boolean; tops: TopView[]; mech: MechView; shadows: number;
  /** Dash cooldown for this round (it grows with the number of tops). */
  dashCooldown: number;
  /** Counts shadow removals, so a guest does not interpolate between two different shadow lists. */
  shadowEpoch: number;
}

const DT = 1 / MATCH.tickRate;
const hyp = Math.hypot;
/** Highest a ball may climb above the rim before it must fall back. */
const RIM_CLEARANCE = 1.2;

/** Keeps a ball inside the rim: a speed up the steep wall must not carry it out of the arena. */
function contain(body: RAPIER.RigidBody, radius: number, restitution: number): void {
  const p = body.translation(), v = body.linvel(), limit = ARENA.rimRadius - radius;
  let { x, y, z } = p, { x: vx, y: vy, z: vz } = v, changed = false;
  const out = clampOval(p.x, p.z, limit);
  if (out) {
    x = out.x; z = out.z;
    const along = vx * out.nx + vz * out.nz;
    if (along > 0) { vx -= (1 + restitution) * along * out.nx; vz -= (1 + restitution) * along * out.nz; }
    changed = true;
  }
  if (y > ARENA.rimHeight + RIM_CLEARANCE && vy > 0) { vy = 0; changed = true; }
  const floor = surfaceHeight(x, z);
  if (y < floor - radius) { y = floor + radius; vy = Math.max(0, vy); changed = true; }
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
  shadowEpoch = 0;
  private pending: PendingShadow[] = [];
  events: GameEvent[] = [];

  constructor(topCount: number, countdown = MATCH.countdown, kit: MechKit = DEFAULT_KIT) {
    this.clock = -countdown;
    this.world = new RAPIER.World({ x: 0, y: -ARENA.gravity, z: 0 });
    this.world.timestep = DT;
    const solid = (desc: RAPIER.ColliderDesc, restitution: number, rule: RAPIER.CoefficientCombineRule) =>
      this.world.createCollider(desc.setFriction(0).setRestitution(restitution).setRestitutionCombineRule(rule).setCollisionGroups(ARENA_GROUPS));
    const bowl = bowlMesh();
    solid(RAPIER.ColliderDesc.trimesh(bowl.vertices, bowl.indices), 0, RAPIER.CoefficientCombineRule.Min);
    const rim = wallMesh();
    solid(RAPIER.ColliderDesc.trimesh(rim.vertices, rim.indices), 1, RAPIER.CoefficientCombineRule.Max);
    for (const w of [...WALLS, ...BUILDINGS]) {
      // Rapier's rotation about +Y turns +X toward −Z, so the layout angle is negated.
      solid(RAPIER.ColliderDesc.cuboid(w.hx, w.hy, w.hz).setTranslation(w.x, w.y, w.z)
        .setRotation({ x: 0, y: Math.sin(-w.angle / 2), z: 0, w: Math.cos(-w.angle / 2) }), 1, RAPIER.CoefficientCombineRule.Max);
    }
    for (const t of TUNNELS) {
      const mesh = tunnelMesh(t);
      // Ramps and passage floors must not bounce, so tops can roll over and through.
      solid(RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices), 0, RAPIER.CoefficientCombineRule.Min);
    }
    for (const t of TREES) {
      solid(RAPIER.ColliderDesc.cylinder(TREE.trunkHeight / 2, TREE.trunk).setTranslation(t.x, t.base + TREE.trunkHeight / 2, t.z), 1, RAPIER.CoefficientCombineRule.Max);
    }

    this.dashCooldown = TOP.dashCooldown * Math.max(1, topCount);
    for (let i = 0; i < topCount; i++) { const [x, z] = SPAWNS[i % SPAWNS.length]!; this.addTop(x, z); }
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, surfaceHeight(0, 0) + MECH.height / 2, 0));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cylinder(MECH.height / 2, MECH.radius)
      .setRestitution(1).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max).setFriction(0).setCollisionGroups(MECH_GROUPS), body);
    this.mech = {
      body, collider, kit: { ...kit }, x: 0, z: 0, yaw: Math.PI, vx: 0, vz: 0, pushX: 0, pushZ: 0, ground: 0, lift: 0,
      last: { boost: 0, jump: 0, parry: 0 },
      moveUntil: -1, moveReadyAt: 0, jump: null, hovering: false, hoverFuel: 0, airReadyAt: 0, guardUntil: -1, guardReadyAt: 0,
      status: createMechStatus(),
    };
  }

  private ball(x: number, z: number, radius: number, member: number, restitution: number): RAPIER.RigidBody {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, surfaceHeight(x, z) + radius + 0.02, z).lockRotations().setCcdEnabled(true)
      .setLinearDamping(member === G_TOP ? TOP.damping : 0));
    this.world.createCollider(RAPIER.ColliderDesc.ball(radius).setFriction(0).setRestitution(restitution)
      .setCollisionGroups(member === G_TOP ? TOP_GROUPS : SHADOW_GROUPS), body);
    return body;
  }
  private addTop(x: number, z: number): void {
    this.tops.push({ body: this.ball(x, z, TOP.radius, G_TOP, TOP.restitution), lastDash: 0, dashUntil: -1, dashReadyAt: 0, dirX: 0, dirZ: 1, spin: 0, flungUntil: -1 });
  }
  /** Adds a shadow directly; used by the dash replay and by tests. */
  addShadow(owner: number, x: number, z: number, dx: number, dz: number): void {
    const body = this.ball(x, z, SHADOW.radius, G_SHADOW, 1);
    const len = hyp(dx, dz) || 1;
    body.setLinvel({ x: (dx / len) * SHADOW.speed, y: 0, z: (dz / len) * SHADOW.speed }, true);
    this.shadows.push({ body, owner, lastHit: -99 });
    this.events.push({ k: 'shadow', top: owner });
  }

  /** Advances one fixed step. Inputs for missing tops are treated as rest. */
  step(tops: readonly TopInput[], mech: MechInput): void {
    if (this.over) return;
    this.clock += DT;
    if (this.clock < 0) return;
    const now = this.clock;
    this.stepTops(tops, now);
    this.stepMech(mech, now);
    while (this.pending.length && this.pending[0]!.at <= now) {
      const p = this.pending.shift()!;
      this.addShadow(p.owner, p.x, p.z, p.dx, p.dz);
    }
    const before = this.tops.map(t => t.body.linvel());
    this.world.step();
    this.endBlockedDashes();
    this.keepShadowSpeed();
    for (const t of this.tops) contain(t.body, TOP.radius, TOP.restitution);
    for (const sh of this.shadows) contain(sh.body, SHADOW.radius, 1);
    this.resolveHits(before, now);
    if (dead(this.mech.status)) { this.over = true; this.events.push({ k: 'over', time: now }); }
  }

  private stepTops(inputs: readonly TopInput[], now: number): void {
    this.tops.forEach((top, i) => {
      const input = inputs[i] ?? REST_TOP;
      const p = top.body.translation(), v = top.body.linvel();
      top.spin += TOP.spinRate * DT;
      if (input.dash !== top.lastDash) {
        top.lastDash = input.dash;
        if (now >= top.dashReadyAt) {
          let dx = input.ax - p.x, dz = input.az - p.z, len = hyp(dx, dz);
          if (len < 0.1) { dx = v.x; dz = v.z; len = hyp(dx, dz); }
          if (len < 0.1) { dx = 0; dz = -1; len = 1; }
          top.dirX = dx / len; top.dirZ = dz / len;
          top.dashUntil = now + TOP.dashTime;
          top.dashReadyAt = now + this.dashCooldown;
          this.pending.push({ at: now + SHADOW.delay, owner: i, x: p.x, z: p.z, dx: top.dirX, dz: top.dirZ });
          this.events.push({ k: 'dash', top: i });
        }
      }
      if (now < top.dashUntil) {
        top.body.setLinvel({ x: top.dirX * TOP.dashSpeed, y: v.y, z: top.dirZ * TOP.dashSpeed }, true);
        return;
      }
      if (now < top.flungUntil) return;
      const len = hyp(input.mx, input.mz);
      const mx = len > 1 ? input.mx / len : input.mx, mz = len > 1 ? input.mz / len : input.mz;
      let nx = v.x + mx * TOP.accel * DT, nz = v.z + mz * TOP.accel * DT;
      const old = hyp(v.x, v.z), next = hyp(nx, nz);
      // Input cannot push past max speed, but bounces and dashes may exceed it and fade by damping.
      if (next > TOP.maxSpeed && next > old) { const cap = Math.max(old, TOP.maxSpeed) / next; nx *= cap; nz *= cap; }
      top.body.setLinvel({ x: nx, y: v.y, z: nz }, true);
    });
  }

  // ---------- Mech ----------

  /** True while the mech is high enough to pass over everything except buildings. */
  get airborne(): boolean { return !!this.mech.jump || (this.mech.hovering && this.mech.lift > AIR_CLEARANCE); }

  private setAir(air: boolean): void { this.mech.collider.setCollisionGroups(air ? MECH_AIR_GROUPS : MECH_GROUPS); }

  private stepMech(input: MechInput, now: number): void {
    const m = this.mech, s = m.status;
    m.ground += Math.max(-MECH.climbRate * DT, Math.min(MECH.climbRate * DT, tunnelLift(m.x, m.z) - m.ground));
    if (m.jump) { this.stepJump(now); return; }
    const control = hasControl(s, now);
    if (control) {
      this.turn(input);
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
    let wx = 0, wz = 0;
    const boosting = m.kit.move === 'boost' && now < m.moveUntil;
    if (control) {
      const len = hyp(input.mx, input.mz);
      if (len > 0.01) {
        const speed = baseSpeed(s) * slowFactor(s, now) * (boosting ? boostFactor(s) : 1) * (m.hovering ? MECH.hoverSpeedFactor : 1);
        wx = (input.mx / Math.max(1, len)) * speed; wz = (input.mz / Math.max(1, len)) * speed;
      }
    }
    const k = boosting ? 1 : Math.min(1, (MECH.accel * DT) / Math.max(0.01, hyp(wx - m.vx, wz - m.vz)));
    m.vx += (wx - m.vx) * k;
    m.vz += (wz - m.vz) * k;
    const decay = Math.exp(-MECH.pushDecay * DT);
    m.pushX *= decay; m.pushZ *= decay;
    m.x += (m.vx + m.pushX) * DT; m.z += (m.vz + m.pushZ) * DT;
    this.keepMechInside(!this.airborne);
    this.placeMech();
  }

  private turn(input: MechInput): void {
    const m = this.mech;
    if (hyp(input.ax - m.x, input.az - m.z) <= 0.3) return;
    let d = Math.atan2(input.ax - m.x, input.az - m.z) - m.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const turn = MECH.turnRate * DT;
    m.yaw += Math.max(-turn, Math.min(turn, d));
  }

  /** Legs slot: boost, or blink toward the mouse. */
  private useMove(input: MechInput, now: number): void {
    const m = this.mech, s = m.status;
    if (now < m.moveReadyAt) return;
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
    this.keepMechInside(true);
  }

  /** Arms slot: parry pulse, or the front shield. */
  private useGuard(now: number): void {
    const m = this.mech, s = m.status;
    if (now < m.guardReadyAt) return;
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

  /** Back slot: jump (returns true when it starts), or begin to hover. */
  private useAir(input: MechInput, now: number): boolean {
    const m = this.mech, s = m.status;
    if (now < m.airReadyAt || m.hovering) return false;
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
    const edge = clampOval(best.x, best.z, MECH.maxRadius);
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
      this.keepMechInside(true);
    }
    this.placeMech();
  }

  private stepHover(input: MechInput, now: number, control: boolean): void {
    const m = this.mech;
    const was = this.airborne;
    if (m.hovering) {
      m.hoverFuel -= DT;
      if (!input.airHeld || !control || m.hoverFuel <= 0) { m.hovering = false; m.airReadyAt = now + MECH.hoverCooldown; }
    }
    const target = m.hovering ? MECH.hoverHeight : 0;
    const rate = (m.hovering ? 8 : 10) * DT;
    const lifted = m.lift > 0;
    m.lift += Math.max(-rate, Math.min(rate, target - m.lift));
    if (lifted && m.lift <= 0 && !m.hovering) { this.events.push({ k: 'land' }); this.keepMechInside(true); }
    if (this.airborne !== was) this.setAir(this.airborne);
  }

  /** Keeps the mech inside the oval and out of buildings; on the ground, also out of half walls and trunks. */
  private keepMechInside(onGround: boolean): void {
    const m = this.mech;
    const edge = clampOval(m.x, m.z, MECH.maxRadius);
    if (edge) { m.x = edge.x; m.z = edge.z; this.blockMech(edge.nx, edge.nz); }
    for (const b of onGround ? [...BUILDINGS, ...WALLS] : BUILDINGS) {
      const hit = pushOutOfBox(b, m.x, m.z, MECH.radius);
      // The push normal points away from the box; movement into the box is along its reverse.
      if (hit) { m.x = hit.x; m.z = hit.z; this.blockMech(-hit.nx, -hit.nz); }
    }
    if (!onGround) return;
    for (const t of TREES) {
      const hit = pushOutOfTree(t, m.x, m.z, MECH.radius);
      if (hit) { m.x = hit.x; m.z = hit.z; this.blockMech(-hit.nx, -hit.nz); }
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
      if (hyp(p.x - m.x, p.z - m.z) <= reach) this.fling(top, now, MECH.parryTopSpeed);
    }
    this.removeShadows(sh => { const p = sh.body.translation(); return hyp(p.x - m.x, p.z - m.z) <= reach; });
  }

  private fling(top: Top, now: number, speed: number): void {
    const m = this.mech, p = top.body.translation();
    const dx = p.x - m.x, dz = p.z - m.z, d = hyp(dx, dz);
    const nx = d > 0.01 ? dx / d : 0, nz = d > 0.01 ? dz / d : 1;
    top.dashUntil = -1;
    top.flungUntil = now + MECH.parryFlingTime;
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

  /** True when an offset from the mech centre lies in the active shield's front arc. */
  private shielded(dx: number, dz: number, now: number): boolean {
    const m = this.mech;
    if (m.kit.guard !== 'shield' || now >= m.guardUntil) return false;
    const [fx, fz] = forward(m.yaw), d = hyp(dx, dz) || 1;
    return (dx * fx + dz * fz) / d >= Math.cos(((MECH.shieldArc / 2) * Math.PI) / 180);
  }

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
      const p = top.body.translation(), dx = p.x - m.x, dz = p.z - m.z, d = hyp(dx, dz);
      if (d > reach(TOP.radius) || Math.abs(p.y - my) > MECH.height / 2 + TOP.radius) return;
      const nx = d > 0.01 ? dx / d : 0, nz = d > 0.01 ? dz / d : 1;
      if (parrying) { if (now >= top.flungUntil) this.fling(top, now, MECH.parryTopSpeed); return; }
      const v = before[i]!;
      const closing = -((v.x - m.vx) * nx + (v.z - m.vz) * nz);
      if (closing < MECH.minHitSpeed) return;
      if (this.shielded(dx, dz, now)) {
        this.fling(top, now, MECH.shieldBounce);
        this.events.push({ k: 'block', x: p.x, z: p.z });
        return;
      }
      const section = hitSection(m.yaw, dx, dz);
      if (applyTopHit(s, section, now)) this.events.push({ k: 'hit', top: i, section, x: p.x, z: p.z });
      top.dashUntil = -1;
      top.body.setLinvel({ x: nx * MECH.topBounce, y: 2, z: nz * MECH.topBounce }, true);
    });
    const touching = (sh: Shadow) => {
      const p = sh.body.translation();
      return hyp(p.x - m.x, p.z - m.z) <= reach(SHADOW.radius) && Math.abs(p.y - my) <= MECH.height / 2 + SHADOW.radius;
    };
    // During the parry, a shadow that touches the mech is deleted; the shield deletes those at its front.
    if (parrying) { this.removeShadows(touching); return; }
    this.removeShadows(sh => { const p = sh.body.translation(); return touching(sh) && this.shielded(p.x - m.x, p.z - m.z, now); });
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
        return { x: q.x, y: q.y, z: q.z, spin: t.spin, dashing: now < t.dashUntil, dashCd: Math.max(0, t.dashReadyAt - now) };
      }),
      mech: {
        x: p.x, y: p.y, z: p.z, yaw: m.yaw, kit: { ...kit },
        air: this.airborne, hover: m.hovering, parry: kit.guard === 'parry' && now < m.guardUntil, shield: kit.guard === 'shield' && now < m.guardUntil,
        boost: kit.move === 'boost' && now < m.moveUntil, control: hasControl(s, now),
        health: s.health, hits: { ...s.hits }, slows: activeSlows(s, now),
        cd: { move: Math.max(0, m.moveReadyAt - now), air: Math.max(0, m.airReadyAt - now), guard: Math.max(0, m.guardReadyAt - now) },
        cdMax: {
          move: kit.move === 'boost' ? MECH.boostCooldown : MECH.blinkCooldown,
          air: kit.air === 'jump' ? MECH.jumpCooldown : MECH.hoverCooldown,
          guard: kit.guard === 'parry' ? MECH.parryCooldown : MECH.shieldCooldown,
        },
        power: {
          move: kit.move === 'boost' ? boostFactor(s) : blinkRange(s),
          air: kit.air === 'jump' ? jumpRange(s) : fuel,
          guard: kit.guard === 'parry' ? parryRadius(s) : shieldTime(s),
        },
        fuel: m.hovering && fuel > 0 ? Math.max(0, m.hoverFuel / fuel) : 1,
      },
      shadows: this.shadows.length,
      dashCooldown: this.dashCooldown,
      shadowEpoch: this.shadowEpoch,
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
