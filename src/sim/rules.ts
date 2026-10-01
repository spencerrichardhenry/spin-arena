import { MATCH, MECH } from '../tuning.ts';

/** Pure mech rules: no Rapier, no three.js. Times are simulation seconds. */

export type Section = 'front' | 'rear' | 'left' | 'right';

/** The mech's three ability slots. Each slot has two options; the lobby picks one per slot. */
export type MoveKit = 'boost' | 'blink' | 'phase';
export type AirKit = 'jump' | 'hover' | 'cloak';
export type GuardKit = 'parry' | 'shield' | 'lock';
export interface MechKit { move: MoveKit; air: AirKit; guard: GuardKit }
export const KIT_OPTIONS = { move: ['boost', 'blink', 'phase'], air: ['jump', 'hover', 'cloak'], guard: ['parry', 'shield', 'lock'] } as const;

/** A top's ability comes from its ring design (the middle part): 0 Blaze, 1 Tidal, 2 Gale, 3 Quake. */
export type TopAbility = 'empower' | 'whirlpool' | 'dash' | 'leap';
export const RING_ABILITIES: readonly TopAbility[] = ['empower', 'whirlpool', 'dash', 'leap'];
export function ringAbility(ring: number): TopAbility { return RING_ABILITIES[((ring % 4) + 4) % 4]!; }
export const DEFAULT_KIT: MechKit = { move: 'boost', air: 'jump', guard: 'parry' };
export function readKit(v: unknown): MechKit | null {
  if (!v || typeof v !== 'object') return null;
  const k = v as MechKit;
  if (!(KIT_OPTIONS.move as readonly string[]).includes(k.move) || !(KIT_OPTIONS.air as readonly string[]).includes(k.air) || !(KIT_OPTIONS.guard as readonly string[]).includes(k.guard)) return null;
  return { move: k.move, air: k.air, guard: k.guard };
}
export const SECTIONS: readonly Section[] = ['front', 'rear', 'left', 'right'];

export interface MechStatus {
  health: number;
  hits: Record<Section, number>;
  /** Expiry time of each active slow stack. */
  slows: number[];
  topImmuneUntil: number;
  pushImmuneUntil: number;
  controlLostUntil: number;
}

export function createMechStatus(): MechStatus {
  return { health: MECH.health, hits: { front: 0, rear: 0, left: 0, right: 0 }, slows: [], topImmuneUntil: -1, pushImmuneUntil: -1, controlLostUntil: -1 };
}

/** Facing vector for a yaw; yaw 0 faces +Z. */
export function forward(yaw: number): [number, number] { return [Math.sin(yaw), Math.cos(yaw)]; }
/** Right-hand vector in a Y-up, right-handed world: forward × up. */
export function right(yaw: number): [number, number] { return [-Math.cos(yaw), Math.sin(yaw)]; }

/** Section struck by a hitter at offset (dx, dz) from the mech centre. Each section covers 90°. */
export function hitSection(yaw: number, dx: number, dz: number): Section {
  const [fx, fz] = forward(yaw), [rx, rz] = right(yaw);
  const f = dx * fx + dz * fz, r = dx * rx + dz * rz;
  if (Math.abs(f) >= Math.abs(r)) return f >= 0 ? 'front' : 'rear';
  return r >= 0 ? 'right' : 'left';
}

export function broken(s: MechStatus, section: Section): boolean { return s.hits[section] >= MECH.plates; }
export function dead(s: MechStatus): boolean { return s.health <= 0; }

/** Returns true when the hit counts. Hits on a broken section still cost health. An empowered hit does 2. */
export function applyTopHit(s: MechStatus, section: Section, now: number, damage = 1): boolean {
  if (dead(s) || now < s.topImmuneUntil) return false;
  s.health = Math.max(0, s.health - damage);
  s.hits[section] = Math.min(MECH.plates, s.hits[section] + damage);
  s.topImmuneUntil = now + MECH.topHitImmunity;
  return true;
}

/** Every shadow hit adds a slow stack; it pushes only outside push immunity. */
export function applyShadowHit(s: MechStatus, now: number): { pushed: boolean } {
  if (dead(s)) return { pushed: false };
  s.slows.push(now + MECH.slowDuration);
  if (now < s.pushImmuneUntil) return { pushed: false };
  s.controlLostUntil = now + MECH.controlLoss;
  s.pushImmuneUntil = now + MECH.pushImmunity;
  return { pushed: true };
}

export function activeSlows(s: MechStatus, now: number): number {
  s.slows = s.slows.filter(t => t > now);
  return s.slows.length;
}
export function slowFactor(s: MechStatus, now: number): number {
  return Math.max(MECH.minSpeedFactor, 1 - MECH.slowPerStack * activeSlows(s, now));
}
export function hasControl(s: MechStatus, now: number): boolean { return now >= s.controlLostUntil; }

export function baseSpeed(s: MechStatus): number {
  return MECH.speed * Math.max(0, 1 - MECH.legHitSpeedLoss * (s.hits.left + s.hits.right));
}
/** Leg power for the legs slot: 1 with both legs, 0.5 with one broken leg, 0 with both broken. */
export function legPower(s: MechStatus): number {
  return 1 - (Number(broken(s, 'left')) + Number(broken(s, 'right'))) / 2;
}
/** Boost multiplier: each broken leg halves the extra speed; both broken means no boost (0). */
export function boostFactor(s: MechStatus): number {
  const p = legPower(s);
  return p === 0 ? 0 : 1 + (MECH.boostFactor - 1) * p;
}
export function blinkRange(s: MechStatus): number { return MECH.blinkRange * legPower(s); }
export function hoverFuel(s: MechStatus): number {
  return broken(s, 'rear') ? 0 : MECH.hoverFuel * (1 - MECH.jumpHitLoss * s.hits.rear);
}
/** Phase uses the legs like boost and blink. */
export function phaseRange(s: MechStatus): number { return MECH.phaseRange * legPower(s); }
/** Cloak uses the back like jump and hover. */
export function cloakTime(s: MechStatus): number {
  return broken(s, 'rear') ? 0 : MECH.cloakTime * (1 - MECH.jumpHitLoss * s.hits.rear);
}
/** Lock uses the arms like parry and shield. */
export function lockTime(s: MechStatus): number {
  return broken(s, 'front') ? 0 : MECH.lockTime * (1 - MECH.parryHitLoss * s.hits.front);
}
export function shieldTime(s: MechStatus): number {
  return broken(s, 'front') ? 0 : MECH.shieldTime * (1 - MECH.parryHitLoss * s.hits.front);
}
export function jumpRange(s: MechStatus): number {
  return broken(s, 'rear') ? 0 : MECH.jumpRange * (1 - MECH.jumpHitLoss * s.hits.rear);
}
export function parryRadius(s: MechStatus): number {
  return broken(s, 'front') ? 0 : MECH.parryRadius * (1 - MECH.parryHitLoss * s.hits.front);
}

export interface ScoreEntry { name: string; tops: number; time: number; date: string }
/** Inserts a result, keeps the best `max` times, and returns the new list and the rank (-1 when not placed). */
export function insertScore(list: readonly ScoreEntry[], entry: ScoreEntry, max = MATCH.highScores): { list: ScoreEntry[]; rank: number } {
  const next = [...list, entry].sort((a, b) => b.time - a.time).slice(0, max);
  return { list: next, rank: next.indexOf(entry) };
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60), s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
