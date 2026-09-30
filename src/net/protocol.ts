import type { ArenaView, GameEvent, MechInput, TopInput } from '../sim/arena.ts';
import type { ScoreEntry } from '../sim/rules.ts';

export const PROTOCOL = 1;
export const MAX_PLAYERS = 5;
export type Team = 'mech' | 'top' | 'watch';
export type Phase = 'lobby' | 'playing' | 'over';

export interface LobbyPlayer { id: string; name: string; team: Team; connected: boolean; host: boolean; bot?: boolean }
export interface Lobby { phase: Phase; players: LobbyPlayer[]; scores: ScoreEntry[]; /** Player id for each top slot, in arena order. */ tops: string[]; mech: string; lastTime: number; lastRank: number }

export type AnyInput = TopInput | MechInput;
export type GuestMessage =
  | { t: 'hello'; version: number; id: string; name: string }
  | { t: 'team'; team: Team }
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
  if (!finite(i.mx, 1.5) || !finite(i.mz, 1.5) || !finite(i.ax, 1000) || !finite(i.az, 1000) || !counter(i.boost) || !counter(i.jump) || !counter(i.parry)) return null;
  return { mx: i.mx, mz: i.mz, ax: i.ax, az: i.az, boost: i.boost, jump: i.jump, parry: i.parry };
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
  p.team = team;
  return true;
}
export function canStart(players: LobbyPlayer[]): boolean {
  const mech = players.filter(p => p.team === 'mech').length, tops = players.filter(p => p.team === 'top').length;
  return mech === 1 && tops >= 1;
}

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function normalizeCode(code: string): string { return code.toUpperCase().replace(/[\s-]/g, ''); }
export function validCode(code: string): boolean { return /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(normalizeCode(code)); }
export function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
export function displayCode(code: string): string { return `${code.slice(0, 4)}-${code.slice(4)}`; }
