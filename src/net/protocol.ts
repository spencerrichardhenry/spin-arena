import type { ArenaView, GameEvent, MechInput, TopInput } from '../sim/arena.ts';
import { DEFAULT_KIT, readKit, type MechKit, type ScoreEntry } from '../sim/rules.ts';
import type { MapId } from '../sim/maps.ts';
export { DEFAULT_KIT, readKit };

export const PROTOCOL = 2;
export const MAX_PLAYERS = 5;
export type Team = 'mech' | 'top' | 'watch';
export type Phase = 'lobby' | 'playing' | 'over';

/** Cosmetic top parts: design index (0–3) for the cap, the attack ring and the tip. */
export interface TopLook { top: number; mid: number; bot: number }
export const PART_COUNT = 4;
export function defaultLook(seed: number): TopLook { const i = ((seed % PART_COUNT) + PART_COUNT) % PART_COUNT; return { top: i, mid: i, bot: i }; }
export function readLook(v: unknown): TopLook | null {
  if (!v || typeof v !== 'object') return null;
  const l = v as TopLook, ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < PART_COUNT;
  return ok(l.top) && ok(l.mid) && ok(l.bot) ? { top: l.top, mid: l.mid, bot: l.bot } : null;
}

export interface LobbyPlayer { id: string; name: string; team: Team; connected: boolean; host: boolean; ready: boolean; bot?: boolean; kit: MechKit; look: TopLook }
export interface Lobby {
  phase: Phase; players: LobbyPlayer[]; map: MapId;
  /** Best times for each map. */ scores: Record<MapId, ScoreEntry[]>;
  /** Player id for each top slot, in arena order. */ tops: string[]; mech: string; lastTime: number; lastRank: number;
}

export type AnyInput = TopInput | MechInput;
export type GuestMessage =
  | { t: 'hello'; version: number; id: string; name: string }
  | { t: 'team'; team: Team }
  | { t: 'ready'; ready: boolean }
  | { t: 'name'; name: string }
  | { t: 'kit'; kit: MechKit }
  | { t: 'look'; look: TopLook }
  | { t: 'input'; input: AnyInput }
  | { t: 'ping' };
export interface Snapshot { seq: number; view: ArenaView; shadows: ArrayBuffer; events: GameEvent[] }
export type HostMessage =
  | { t: 'welcome'; id: string }
  | { t: 'lobby'; lobby: Lobby }
  | { t: 'snap'; snap: Snapshot }
  | { t: 'error'; message: string }
  | { t: 'pong' };

const SCALE = 100;
/** Packs positions to 16-bit integers with 1 cm precision (limit ±327 m). */
export function packShadows(positions: Float32Array): ArrayBuffer {
  const out = new Int16Array(positions.length);
  for (let i = 0; i < positions.length; i++) out[i] = Math.max(-32767, Math.min(32767, Math.round(positions[i]! * SCALE)));
  return out.buffer;
}
export function unpackShadows(buffer: ArrayBuffer, out?: Float32Array): Float32Array {
  const src = new Int16Array(buffer);
  const dst = out && out.length === src.length ? out : new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) dst[i] = src[i]! / SCALE;
  return dst;
}

const finite = (v: unknown, limit: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
const counter = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1e9;

export function readTopInput(v: unknown): TopInput | null {
  if (!v || typeof v !== 'object') return null;
  const i = v as TopInput;
  if (!finite(i.mx, 1.5) || !finite(i.mz, 1.5) || !finite(i.ax, 1000) || !finite(i.az, 1000) || !counter(i.dash)) return null;
  return { mx: i.mx, mz: i.mz, ax: i.ax, az: i.az, dash: i.dash };
}
export function readMechInput(v: unknown): MechInput | null {
  if (!v || typeof v !== 'object') return null;
  const i = v as MechInput;
  if (!finite(i.mx, 1.5) || !finite(i.mz, 1.5) || !finite(i.ax, 1000) || !finite(i.az, 1000) || !counter(i.boost) || !counter(i.jump) || !counter(i.parry) || typeof i.airHeld !== 'boolean') return null;
  return { mx: i.mx, mz: i.mz, ax: i.ax, az: i.az, boost: i.boost, jump: i.jump, parry: i.parry, airHeld: i.airHeld };
}

export function cleanName(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, 16) : '';
  return s || 'Player';
}
export function readTeam(v: unknown): Team | null { return v === 'mech' || v === 'top' || v === 'watch' ? v : null; }

/** Applies a team request. Only one mech, and at most `maxTops` tops; a full team leaves the request unchanged. */
export function chooseTeam(players: LobbyPlayer[], id: string, team: Team, maxTops: number): boolean {
  const p = players.find(x => x.id === id);
  if (!p || p.team === team) return false;
  if (team === 'mech' && players.some(x => x.team === 'mech' && x.id !== id)) return false;
  if (team === 'top' && players.filter(x => x.team === 'top' && x.id !== id).length >= maxTops) return false;
  p.team = team; p.ready = false;
  return true;
}
/** One mech and one to four tops. */
export function teamsOk(players: readonly LobbyPlayer[]): boolean {
  const mech = players.filter(p => p.team === 'mech').length, tops = players.filter(p => p.team === 'top').length;
  return mech === 1 && tops >= 1;
}
/** Bots are always ready; a second keyboard player (id `<owner>~2`) is ready when its owner is. */
export function isReady(players: readonly LobbyPlayer[], p: LobbyPlayer): boolean {
  if (p.bot || p.ready) return true;
  return p.id.endsWith('~2') && !!players.find(o => o.id === p.id.slice(0, -2))?.ready;
}
export function notReady(players: readonly LobbyPlayer[]): LobbyPlayer[] { return players.filter(p => p.connected && !isReady(players, p)); }
export function canStart(players: readonly LobbyPlayer[]): boolean { return teamsOk(players) && notReady(players).length === 0; }

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function normalizeCode(code: string): string { return code.toUpperCase().replace(/[\s-]/g, ''); }
export function validCode(code: string): boolean { return /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(normalizeCode(code)); }
export function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
export function displayCode(code: string): string { return `${code.slice(0, 4)}-${code.slice(4)}`; }
