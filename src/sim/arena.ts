import RAPIER from '@dimforge/rapier3d-compat';
import { ARENA, MATCH, MECH, SHADOW, TOP } from '../tuning.ts';
import { bowlMesh, clampOval, pushOutOfWall, surfaceHeight, wallBoxes, wallMesh, type WallBox } from './bowl.ts';
import {
  applyShadowHit, applyTopHit, boostFactor, baseSpeed, createMechStatus, dead, hasControl, hitSection,
  jumpRange, parryRadius, slowFactor, activeSlows, type MechStatus, type Section,
} from './rules.ts';

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> { return (ready ??= RAPIER.init()); }

/** Movement is a unit-or-shorter vector; aim is a world point; *Id values count button presses. */
export interface TopInput { mx: number; mz: number; ax: number; az: number; dash: number }
export interface MechInput { mx: number; mz: number; ax: number; az: number; boost: number; jump: number; parry: number }
export const REST_TOP: TopInput = { mx: 0, mz: 0, ax: 0, az: 0, dash: 0 };
export const REST_MECH: MechInput = { mx: 0, mz: 0, ax: 0, az: 1, boost: 0, jump: 0, parry: 0 };

export type GameEvent =
  | { k: 'hit'; top: number; section: Section; x: number; z: number }
  | { k: 'shadowHit'; pushed: boolean; x: number; z: number }
  | { k: 'pop'; x: number; z: number }
  | { k: 'dash'; top: number }
  | { k: 'shadow'; top: number }
  | { k: 'parry'; radius: number }
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
  x: number; z: number; yaw: number;
  vx: number; vz: number;
  pushX: number; pushZ: number;
  last: { boost: number; jump: number; parry: number };
  boostUntil: number; boostReadyAt: number;
  jump: Jump | null; jumpReadyAt: number;
  parryUntil: number; parryReadyAt: number;
  status: MechStatus;
}

export interface TopView { x: number; y: number; z: number; spin: number; dashing: boolean; dashCd: number }
export interface MechView {
  x: number; y: number; z: number; yaw: number; air: boolean; parry: boolean; boost: boolean; control: boolean;
  health: number; hits: Record<Section, number>; slows: number;
  cd: { boost: number; jump: number; parry: number };
  power: { boost: number; jump: number; parry: number };
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
  readonly walls: WallBox[] = wallBoxes();
  readonly dashCooldown: number;
  shadowEpoch = 0;
  private pending: PendingShadow[] = [];
  events: GameEvent[] = [];

  constructor(topCount: number, countdown = MATCH.countdown) {
    this.clock = -countdown;
    this.world = new RAPIER.World({ x: 0, y: -ARENA.gravity, z: 0 });
    this.world.timestep = DT;
    const bowl = bowlMesh();
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(bowl.vertices, bowl.indices)
      .setFriction(0).setRestitution(0).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min).setCollisionGroups(ARENA_GROUPS));
    const wall = wallMesh();
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(wall.vertices, wall.indices)
      .setFriction(0).setRestitution(1).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max).setCollisionGroups(ARENA_GROUPS));

    for (const w of this.walls) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(w.hx, w.hy, w.hz).setTranslation(w.x, w.y, w.z)
        // Rapier's rotation about +Y turns +X toward −Z, so the wall angle is negated.
        .setRotation({ x: 0, y: Math.sin(-w.angle / 2), z: 0, w: Math.cos(-w.angle / 2) })
        .setFriction(0).setRestitution(1).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max).setCollisionGroups(ARENA_GROUPS));
    }

    this.dashCooldown = TOP.dashCooldown * Math.max(1, topCount);
    for (let i = 0; i < topCount; i++) {
      const a = (i / Math.max(1, topCount)) * Math.PI * 2 + Math.PI / 4;
      this.addTop(Math.cos(a) * TOP.spawnRadius * ARENA.stretch, Math.sin(a) * TOP.spawnRadius);
    }
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, surfaceHeight(0, 0) + MECH.height / 2, 0));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cylinder(MECH.height / 2, MECH.radius)
      .setRestitution(1).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max).setFriction(0).setCollisionGroups(MECH_GROUPS), body);
    this.mech = {
      body, collider, x: 0, z: 0, yaw: Math.PI, vx: 0, vz: 0, pushX: 0, pushZ: 0,
      last: { boost: 0, jump: 0, parry: 0 },
      boostUntil: -1, boostReadyAt: 0, jump: null, jumpReadyAt: 0, parryUntil: -1, parryReadyAt: 0,
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

  private stepMech(input: MechInput, now: number): void {
    const m = this.mech, s = m.status;
    const control = hasControl(s, now);
    if (m.jump) {
      const t = Math.min(1, (now - m.jump.start) / MECH.jumpTime);
      m.x = m.jump.fx + (m.jump.tx - m.jump.fx) * t;
      m.z = m.jump.fz + (m.jump.tz - m.jump.fz) * t;
      const lift = 4 * MECH.jumpHeight * t * (1 - t);
      this.placeMech(lift);
      if (t >= 1) {
        m.jump = null; m.collider.setCollisionGroups(MECH_GROUPS); this.events.push({ k: 'land' });
        this.keepMechOutOfWalls();
        this.placeMech(0);
      }
      return;
    }
    if (control) {
      const want = Math.atan2(input.ax - m.x, input.az - m.z);
      if (hyp(input.ax - m.x, input.az - m.z) > 0.3) {
        let d = want - m.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const turn = MECH.turnRate * DT;
        m.yaw += Math.max(-turn, Math.min(turn, d));
      }
      if (input.boost !== m.last.boost) {
        m.last.boost = input.boost;
        if (now >= m.boostReadyAt && boostFactor(s) > 0) { m.boostUntil = now + MECH.boostTime; m.boostReadyAt = now + MECH.boostCooldown; this.events.push({ k: 'boost' }); }
      }
      if (input.parry !== m.last.parry) {
        m.last.parry = input.parry;
        const radius = parryRadius(s);
        if (now >= m.parryReadyAt && radius > 0) { m.parryUntil = now + MECH.parryActive; m.parryReadyAt = now + MECH.parryCooldown; this.pulse(radius, now); this.events.push({ k: 'parry', radius }); }
      }
      if (input.jump !== m.last.jump) {
        m.last.jump = input.jump;
        const range = jumpRange(s);
        if (now >= m.jumpReadyAt && range > 0) {
          let dx = input.ax - m.x, dz = input.az - m.z;
          const len = hyp(dx, dz);
          if (len > range) { dx *= range / len; dz *= range / len; }
          let tx = m.x + dx, tz = m.z + dz;
          const edge = clampOval(tx, tz, MECH.maxRadius);
          if (edge) { tx = edge.x; tz = edge.z; }
          m.jump = { fx: m.x, fz: m.z, tx, tz, start: now };
          m.jumpReadyAt = now + MECH.jumpCooldown;
          m.vx = m.vz = m.pushX = m.pushZ = 0;
          m.collider.setCollisionGroups(MECH_AIR_GROUPS);
          this.events.push({ k: 'jump' });
          this.placeMech(0);
          return;
        }
      }
    } else {
      // Consume presses made while stunned so they do not fire afterwards.
      m.last = { boost: input.boost, jump: input.jump, parry: input.parry };
    }
    let wx = 0, wz = 0;
    if (control) {
      const len = hyp(input.mx, input.mz);
      if (len > 0.01) {
        const speed = baseSpeed(s) * slowFactor(s, now) * (now < m.boostUntil ? boostFactor(s) : 1);
        wx = (input.mx / Math.max(1, len)) * speed; wz = (input.mz / Math.max(1, len)) * speed;
      }
    }
    const k = Math.min(1, (MECH.accel * DT) / Math.max(0.01, hyp(wx - m.vx, wz - m.vz)));
    m.vx += (wx - m.vx) * (now < m.boostUntil ? 1 : k);
    m.vz += (wz - m.vz) * (now < m.boostUntil ? 1 : k);
    const decay = Math.exp(-MECH.pushDecay * DT);
    m.pushX *= decay; m.pushZ *= decay;
    m.x += (m.vx + m.pushX) * DT; m.z += (m.vz + m.pushZ) * DT;
    const edge = clampOval(m.x, m.z, MECH.maxRadius);
    if (edge) { m.x = edge.x; m.z = edge.z; this.blockMech(edge.nx, edge.nz); }
    this.keepMechOutOfWalls();
    this.placeMech(0);
  }

  /** Removes velocity along n (the direction into a blocking surface); a knock-back bounces off it instead. */
  private blockMech(nx: number, nz: number): void {
    const m = this.mech;
    const out = m.vx * nx + m.vz * nz; if (out > 0) { m.vx -= out * nx; m.vz -= out * nz; }
    const pout = m.pushX * nx + m.pushZ * nz; if (pout > 0) { m.pushX -= 2 * pout * nx; m.pushZ -= 2 * pout * nz; }
  }

  /** On the ground, the half walls block the mech. In the air it passes over them. */
  private keepMechOutOfWalls(): void {
    const m = this.mech;
    for (const w of this.walls) {
      const hit = pushOutOfWall(w, m.x, m.z, MECH.radius);
      if (!hit) continue;
      m.x = hit.x; m.z = hit.z;
      // The push normal points away from the wall; movement into the wall is along its reverse.
      this.blockMech(-hit.nx, -hit.nz);
    }
  }

  private placeMech(lift: number): void {
    const m = this.mech;
    m.body.setNextKinematicTranslation({ x: m.x, y: surfaceHeight(m.x, m.z) + MECH.height / 2 + lift, z: m.z });
  }

  private mechY(): number { return this.mech.body.translation().y; }

  /** Parry pulse: fling every top in the radius across the arena, and delete every shadow in it. */
  private pulse(radius: number, now: number): void {
    const m = this.mech, reach = radius + MECH.radius;
    for (const top of this.tops) {
      const p = top.body.translation();
      if (hyp(p.x - m.x, p.z - m.z) <= reach) this.fling(top, now);
    }
    this.removeShadows(sh => { const p = sh.body.translation(); return hyp(p.x - m.x, p.z - m.z) <= reach; });
  }

  private fling(top: Top, now: number): void {
    const m = this.mech, p = top.body.translation();
    const dx = p.x - m.x, dz = p.z - m.z, d = hyp(dx, dz);
    const nx = d > 0.01 ? dx / d : 0, nz = d > 0.01 ? dz / d : 1;
    top.dashUntil = -1;
    top.flungUntil = now + MECH.parryFlingTime;
    top.body.setLinvel({ x: nx * MECH.parryTopSpeed, y: 4, z: nz * MECH.parryTopSpeed }, true);
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
      const target = SHADOW.speed;
      const h = hyp(v.x, v.z);
      if (h < 0.05) {
        // Stalled (for example at the top of the rim): send it back toward the centre.
        const p = sh.body.translation(), r = hyp(p.x, p.z) || 1;
        sh.body.setLinvel({ x: (-p.x / r) * target, y: v.y, z: (-p.z / r) * target }, true);
      } else sh.body.setLinvel({ x: (v.x / h) * target, y: v.y, z: (v.z / h) * target }, true);
    }
  }

  private resolveHits(before: { x: number; y: number; z: number }[], now: number): void {
    const m = this.mech, s = m.status;
    if (m.jump) return;
    const my = this.mechY(), parrying = now < m.parryUntil;
    const reach = (r: number) => MECH.radius + r + 0.25;
    this.tops.forEach((top, i) => {
      const p = top.body.translation(), dx = p.x - m.x, dz = p.z - m.z, d = hyp(dx, dz);
      if (d > reach(TOP.radius) || Math.abs(p.y - my) > MECH.height / 2 + TOP.radius) return;
      const nx = d > 0.01 ? dx / d : 0, nz = d > 0.01 ? dz / d : 1;
      if (parrying) { if (now >= top.flungUntil) this.fling(top, now); return; }
      const v = before[i]!;
      const closing = -((v.x - m.vx) * nx + (v.z - m.vz) * nz);
      if (closing < MECH.minHitSpeed) return;
      const section = hitSection(m.yaw, dx, dz);
      if (applyTopHit(s, section, now)) this.events.push({ k: 'hit', top: i, section, x: p.x, z: p.z });
      top.dashUntil = -1;
      top.body.setLinvel({ x: nx * MECH.topBounce, y: 2, z: nz * MECH.topBounce }, true);
    });
    const touching = (sh: Shadow) => {
      const p = sh.body.translation();
      return hyp(p.x - m.x, p.z - m.z) <= reach(SHADOW.radius) && Math.abs(p.y - my) <= MECH.height / 2 + SHADOW.radius;
    };
    // During the parry, a shadow that touches the mech is deleted.
    if (parrying) { this.removeShadows(touching); return; }
    for (const sh of this.shadows) {
      if (now - sh.lastHit < SHADOW.rehitTime || !touching(sh)) continue;
      const p = sh.body.translation(), dx = p.x - m.x, dz = p.z - m.z, d = hyp(dx, dz);
      const nx = d > 0.01 ? dx / d : 0, nz = d > 0.01 ? dz / d : 1;
      sh.lastHit = now;
      const { pushed } = applyShadowHit(s, now);
      if (pushed) { m.pushX = -nx * MECH.pushSpeed; m.pushZ = -nz * MECH.pushSpeed; m.vx = m.vz = 0; m.boostUntil = -1; }
      // Send the shadow away so it does not stay against the mech.
      const v = sh.body.linvel();
      if (v.x * nx + v.z * nz < 0) sh.body.setLinvel({ x: nx * SHADOW.speed, y: v.y, z: nz * SHADOW.speed }, true);
      this.events.push({ k: 'shadowHit', pushed, x: p.x, z: p.z });
    }
  }

  /** Takes and clears the events since the last call. */
  drainEvents(): GameEvent[] { const e = this.events; this.events = []; return e; }

  view(): ArenaView {
    const now = Math.max(0, this.clock), m = this.mech, s = m.status, p = m.body.translation();
    return {
      clock: this.clock,
      over: this.over,
      tops: this.tops.map(t => {
        const q = t.body.translation();
        return { x: q.x, y: q.y, z: q.z, spin: t.spin, dashing: now < t.dashUntil, dashCd: Math.max(0, t.dashReadyAt - now) };
      }),
      mech: {
        x: p.x, y: p.y, z: p.z, yaw: m.yaw, air: !!m.jump, parry: now < m.parryUntil, boost: now < m.boostUntil,
        control: hasControl(s, now), health: s.health, hits: { ...s.hits }, slows: activeSlows(s, now),
        cd: { boost: Math.max(0, m.boostReadyAt - now), jump: Math.max(0, m.jumpReadyAt - now), parry: Math.max(0, m.parryReadyAt - now) },
        power: { boost: boostFactor(s), jump: jumpRange(s), parry: parryRadius(s) },
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
