import { Arena, REST_MECH, REST_TOP, type ArenaView, type GameEvent, type MechInput, type TopInput } from './sim/arena.ts';
import { MechBot, TopBot } from './sim/bots.ts';
import { insertScore, type ScoreEntry } from './sim/rules.ts';
import { MATCH } from './tuning.ts';
import { MAP_IDS, readMapId, type MapId } from './sim/maps.ts';
import {
  canStart, chooseTeam, cleanName, DEFAULT_KIT, defaultLook, packShadows, readKit, readLook, readMechInput, readTeam, readTopInput, unpackShadows,
  type AnyInput, type GuestMessage, type HostMessage, type Lobby, type LobbyPlayer, type Snapshot, type Team, type TopLook,
} from './net/protocol.ts';
import { ringAbility, type MechKit } from './sim/rules.ts';
import type { Room } from './net/room.ts';
import type { Frame } from './render/scene.ts';

const SCORE_KEY = 'spin-arena-scores-v2', OLD_SCORE_KEY = 'spin-arena-scores';
const STALE_MS = 600;
const DT = 1 / MATCH.tickRate;

type ScoreBoard = Record<MapId, ScoreEntry[]>;
const validEntry = (s: unknown): s is ScoreEntry => !!s && typeof (s as ScoreEntry).time === 'number' && typeof (s as ScoreEntry).name === 'string';

/** Saved best times: one list per map. The old single list (before maps) belongs to City Bowl. */
export function readScores(v2: unknown, old: unknown): ScoreBoard {
  const take = (list: unknown) => (Array.isArray(list) ? list.filter(validEntry).slice(0, MATCH.highScores) : []);
  const board = Object.fromEntries(MAP_IDS.map(id => [id, [] as ScoreEntry[]])) as ScoreBoard;
  if (v2 && typeof v2 === 'object') for (const id of MAP_IDS) board[id] = take((v2 as Record<string, unknown>)[id]);
  else board.city = take(old);
  return board;
}
function loadScores(): ScoreBoard {
  const parse = (key: string): unknown => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
  return readScores(parse(SCORE_KEY), parse(OLD_SCORE_KEY));
}
function saveScores(board: ScoreBoard): void { try { localStorage.setItem(SCORE_KEY, JSON.stringify(board)); } catch { /* storage unavailable */ } }

export interface Session {
  readonly selfId: string;
  readonly lobby: Lobby | null;
  readonly isHost: boolean;
  onLobby: () => void;
  setTeam(team: Team): void;
  setKit(kit: MechKit): void;
  setLook(look: TopLook): void;
  setReady(ready: boolean): void;
  setName(name: string): void;
  update(dt: number, input: (team: Team) => AnyInput, second?: () => TopInput): void;
  /** The second player on this keyboard, if any. */
  readonly secondId: string | null;
  frame(): Frame | null;
}

/** The host runs the simulation for everyone. Without a room, it is a local practice session. */
export class HostSession implements Session {
  readonly isHost = true;
  lobby: Lobby;
  arena: Arena | null = null;
  onLobby: () => void = () => {};
  private inputs = new Map<string, { input: AnyInput; at: number }>();
  private bots = new Map<string, TopBot | MechBot>();
  private botCount = 0;
  private joined = 0;
  secondId: string | null = null;
  private acc = 0;
  private ticks = 0;
  private seq = 0;
  private netEvents: GameEvent[] = [];
  private localEvents: GameEvent[] = [];
  private lastView: ArenaView | null = null;
  private lastShadows: Float32Array = new Float32Array(0);

  constructor(readonly selfId: string, name: string, private readonly room: Room | null) {
    this.lobby = { phase: 'lobby', players: [{ id: selfId, name: cleanName(name), team: 'mech', connected: true, host: true, ready: false, kit: { ...DEFAULT_KIT }, look: defaultLook(0) }], map: 'city', scores: loadScores(), tops: [], mech: '', lastTime: 0, lastRank: -1 };
    if (room) {
      room.onGuestJoin = (id, guestName) => {
        const old = this.lobby.players.find(p => p.id === id);
        if (old) { old.connected = true; old.name = guestName; }
        else {
          const team: Team = this.lobby.phase === 'lobby' && this.lobby.players.filter(p => p.team === 'top').length < MATCH.maxTops ? 'top' : 'watch';
          this.lobby.players.push({ id, name: guestName, team, connected: true, host: false, ready: false, kit: { ...DEFAULT_KIT }, look: defaultLook(++this.joined) });
        }
        this.changed();
      };
      room.onGuestLeave = id => {
        const p = this.lobby.players.find(x => x.id === id);
        if (!p) return;
        // Keep a player's slot during a round so a reconnect gets the same top back.
        if (this.lobby.phase === 'lobby') this.lobby.players = this.lobby.players.filter(x => x.id !== id);
        else p.connected = false;
        this.inputs.delete(id);
        this.changed();
      };
      room.onGuestMessage = (id, msg) => this.guestMessage(id, msg);
    }
  }

  private guestMessage(id: string, msg: GuestMessage): void {
    if (msg.t === 'team') { const team = readTeam(msg.team); if (team) this.chooseTeam(id, team); }
    else if (msg.t === 'ready') { if (typeof msg.ready === 'boolean') this.setPlayer(id, { ready: msg.ready }); }
    else if (msg.t === 'name') this.setPlayer(id, { name: msg.name });
    else if (msg.t === 'kit') { const kit = readKit(msg.kit); if (kit) this.setPlayer(id, { kit }); }
    else if (msg.t === 'look') { const look = readLook(msg.look); if (look) this.setPlayer(id, { look }); }
    else if (msg.t === 'input') {
      const top = this.lobby.tops.includes(id), mech = this.lobby.mech === id;
      const input = mech ? readMechInput(msg.input) : top ? readTopInput(msg.input) : null;
      if (input) this.inputs.set(id, { input, at: performance.now() });
    }
  }

  private changed(): void {
    this.room?.broadcast({ t: 'lobby', lobby: this.lobby } satisfies HostMessage);
    this.onLobby();
  }

  private chooseTeam(id: string, team: Team): void {
    if (this.lobby.phase !== 'lobby') return;
    if (chooseTeam(this.lobby.players, id, team, MATCH.maxTops)) this.changed();
  }
  setTeam(team: Team): void { this.chooseTeam(this.selfId, team); }
  setKit(kit: MechKit): void { this.setPlayer(this.selfId, { kit }); }
  setLook(look: TopLook): void { this.setPlayer(this.selfId, { look }); }
  setReady(ready: boolean): void { this.setPlayer(this.selfId, { ready }); }
  setName(name: string): void {
    this.setPlayer(this.selfId, { name });
    if (this.secondId) this.setPlayer(this.secondId, { name: `${cleanName(name)} 2` });
  }
  private setPlayer(id: string, change: { kit?: MechKit; look?: TopLook; ready?: boolean; name?: unknown }): void {
    const p = this.lobby.players.find(x => x.id === id);
    if (!p || this.lobby.phase !== 'lobby') return;
    if (change.kit) p.kit = { ...change.kit };
    if (change.look) p.look = { ...change.look };
    if (change.ready !== undefined) p.ready = change.ready;
    if (change.name !== undefined) p.name = cleanName(change.name);
    this.changed();
  }

  /** Adds a practice bot to a team. */
  addBot(team: 'mech' | 'top'): void {
    if (this.lobby.phase !== 'lobby') return;
    const id = `bot-${++this.botCount}`;
    const player: LobbyPlayer = {
      id, name: team === 'mech' ? 'Bot Mech' : `Bot ${this.botCount}`, team: 'watch', connected: true, host: false, ready: true, bot: true,
      kit: { ...DEFAULT_KIT }, look: { top: this.botCount % 4, mid: (this.botCount + 1) % 4, bot: (this.botCount + 2) % 4 },
    };
    this.lobby.players.push(player);
    if (!chooseTeam(this.lobby.players, id, team, MATCH.maxTops)) { this.lobby.players.pop(); return; }
    this.changed();
  }
  removeBots(): void {
    if (this.lobby.phase !== 'lobby') return;
    this.lobby.players = this.lobby.players.filter(p => !p.bot);
    this.changed();
  }

  /** Adds or removes a second player (a top) who shares this computer's keyboard. */
  setSecond(on: boolean, name: string): void {
    if (this.lobby.phase !== 'lobby') return;
    if (on && !this.secondId) {
      const id = `${this.selfId}~2`;
      const team: Team = this.lobby.players.filter(p => p.team === 'top').length < MATCH.maxTops ? 'top' : 'watch';
      this.lobby.players.push({ id, name: cleanName(name), team, connected: true, host: false, ready: false, kit: { ...DEFAULT_KIT }, look: defaultLook(++this.joined) });
      this.secondId = id;
    } else if (!on && this.secondId) {
      this.lobby.players = this.lobby.players.filter(p => p.id !== this.secondId);
      this.secondId = null;
    }
    this.changed();
  }

  /** The host picks the map in the lobby. */
  chooseMap(map: MapId): void {
    const id = readMapId(map);
    if (!id || this.lobby.phase !== 'lobby') return;
    this.lobby.map = id;
    this.changed();
  }

  get canStart(): boolean { return this.lobby.phase === 'lobby' && canStart(this.lobby.players); }

  start(countdown = MATCH.countdown): void {
    if (!this.canStart) return;
    const tops = this.lobby.players.filter(p => p.team === 'top');
    this.lobby.tops = tops.map(p => p.id);
    this.lobby.mech = this.lobby.players.find(p => p.team === 'mech')!.id;
    this.bots.clear();
    tops.forEach((p, i) => { if (p.bot) this.bots.set(p.id, new TopBot(i)); });
    const mech = this.lobby.players.find(p => p.id === this.lobby.mech)!;
    if (mech.bot) this.bots.set(mech.id, new MechBot());
    this.arena?.dispose();
    // Each top's ability comes from its ring.
    this.arena = new Arena(tops.length, countdown, mech.kit, tops.map(p => ringAbility(p.look.mid)), this.lobby.map);
    this.lastView = this.arena.view();
    this.inputs.clear();
    this.acc = 0; this.ticks = 0; this.seq = 0;
    this.lobby.phase = 'playing';
    this.changed();
  }

  backToLobby(): void {
    if (this.lobby.phase === 'lobby') return;
    this.arena?.dispose(); this.arena = null;
    this.lobby.phase = 'lobby';
    // Players that left during the round are removed now.
    this.lobby.players = this.lobby.players.filter(p => p.connected);
    for (const p of this.lobby.players) p.ready = false;
    this.changed();
  }

  private inputFor(id: string, mech: boolean): AnyInput {
    const bot = this.bots.get(id);
    if (bot && this.lastView) return bot instanceof MechBot ? bot.input(this.lastView) : bot.input(this.lastView, DT);
    const entry = this.inputs.get(id);
    const rest = mech ? REST_MECH : REST_TOP;
    if (!entry) return rest;
    // A silent guest stops moving but keeps its button counters, so nothing fires twice.
    return performance.now() - entry.at > STALE_MS ? { ...entry.input, mx: 0, mz: 0 } : entry.input;
  }

  update(dt: number, local: (team: Team) => AnyInput, second?: () => TopInput): void {
    const arena = this.arena;
    if (!arena || this.lobby.phase !== 'playing') return;
    const self = this.lobby.players.find(p => p.id === this.selfId);
    if (self && (self.team === 'mech' || self.team === 'top')) this.inputs.set(this.selfId, { input: local(self.team), at: performance.now() });
    if (this.secondId && second && this.lobby.tops.includes(this.secondId)) this.inputs.set(this.secondId, { input: second(), at: performance.now() });
    this.acc = Math.min(this.acc + dt, 0.5);
    while (this.acc >= DT) {
      this.acc -= DT;
      const tops = this.lobby.tops.map(id => this.inputFor(id, false) as TopInput);
      arena.step(tops, this.inputFor(this.lobby.mech, true) as MechInput);
      const events = arena.drainEvents();
      this.netEvents.push(...events); this.localEvents.push(...events);
      this.lastView = arena.view();
      if (++this.ticks % Math.round(MATCH.tickRate / MATCH.snapshotRate) === 0 || arena.over) this.sendSnapshot();
      if (arena.over) { this.finish(arena.survival); break; }
    }
    this.lastShadows = arena.shadowPositions(this.lastShadows.length === arena.shadows.length * 3 ? this.lastShadows : undefined);
  }

  private sendSnapshot(): void {
    if (!this.room || !this.arena || !this.lastView) return;
    const snap: Snapshot = { seq: ++this.seq, view: this.lastView, shadows: packShadows(this.arena.shadowPositions()), events: this.netEvents };
    this.netEvents = [];
    this.room.broadcast({ t: 'snap', snap }, true);
  }

  private finish(time: number): void {
    const mech = this.lobby.players.find(p => p.id === this.lobby.mech);
    const practice = this.lobby.players.some(p => p.bot && (p.team === 'top' || p.team === 'mech'));
    this.lobby.lastTime = time;
    this.lobby.lastRank = -1;
    if (!practice) {
      const entry: ScoreEntry = { name: mech?.name ?? 'Mech', tops: this.lobby.tops.length, time: Math.round(time * 10) / 10, date: new Date().toISOString().slice(0, 10) };
      const result = insertScore(this.lobby.scores[this.lobby.map], entry);
      this.lobby.scores[this.lobby.map] = result.list; this.lobby.lastRank = result.rank;
      saveScores(this.lobby.scores);
    }
    this.lobby.phase = 'over';
    this.changed();
  }

  frame(): Frame | null {
    if (!this.arena || !this.lastView) return null;
    const events = this.localEvents; this.localEvents = [];
    return { view: this.lastView, shadows: this.lastShadows, events };
  }
}

interface Buffered { at: number; snap: Snapshot; shadows: Float32Array }

/** A guest renders host snapshots about 100 ms late and interpolates between them. */
export class GuestSession implements Session {
  readonly isHost = false;
  /** The second keyboard player's id; on a guest computer it joins over its own connection (see main.ts). */
  secondId: string | null = null;
  lobby: Lobby | null = null;
  onLobby: () => void = () => {};
  private buffer: Buffered[] = [];
  private events: GameEvent[] = [];
  private lastSend = 0;
  private out: Float32Array = new Float32Array(0);

  constructor(readonly selfId: string, private readonly room: Room) {
    room.onHostMessage = msg => {
      if (msg.t === 'lobby') {
        const newRound = msg.lobby.phase === 'playing' && this.lobby?.phase !== 'playing';
        if (newRound) this.buffer = [];
        this.lobby = msg.lobby; this.onLobby();
      } else if (msg.t === 'snap') this.receive(msg.snap);
    };
  }

  private receive(snap: Snapshot): void {
    const last = this.buffer[this.buffer.length - 1];
    if (last && snap.seq <= last.snap.seq) { if (snap.seq < last.snap.seq - 50) this.buffer = []; else return; }
    this.buffer.push({ at: performance.now(), snap, shadows: unpackShadows(snap.shadows) });
    if (this.buffer.length > 30) this.buffer.shift();
    this.events.push(...snap.events);
  }

  setTeam(team: Team): void { this.room.toHost({ t: 'team', team }); }
  setKit(kit: MechKit): void { this.room.toHost({ t: 'kit', kit }); }
  setLook(look: TopLook): void { this.room.toHost({ t: 'look', look }); }
  setReady(ready: boolean): void { this.room.toHost({ t: 'ready', ready }); }
  setName(name: string): void { this.room.toHost({ t: 'name', name }); }

  update(_dt: number, local: (team: Team) => AnyInput): void {
    const lobby = this.lobby;
    if (!lobby || lobby.phase !== 'playing') return;
    const now = performance.now();
    if (now - this.lastSend < 1000 / 60) return;
    this.lastSend = now;
    if (lobby.mech === this.selfId) this.room.toHost({ t: 'input', input: local('mech') });
    else if (lobby.tops.includes(this.selfId)) this.room.toHost({ t: 'input', input: local('top') });
  }

  frame(): Frame | null {
    const b = this.buffer;
    if (!b.length) return null;
    const renderAt = performance.now() - MATCH.interpDelayMs;
    let i = b.length - 1;
    while (i > 0 && b[i - 1]!.at > renderAt) i--;
    const next = b[i]!, prev = b[Math.max(0, i - 1)]!;
    const span = next.at - prev.at;
    const k = span > 0 ? Math.max(0, Math.min(1, (renderAt - prev.at) / span)) : 1;
    const events = this.events; this.events = [];
    // After a parry deletes shadows, the two lists no longer match index by index.
    const same = prev.snap.view.shadowEpoch === next.snap.view.shadowEpoch;
    return { view: lerpView(prev.snap.view, next.snap.view, k), shadows: this.lerpShadows(prev.shadows, next.shadows, same ? k : 1), events };
  }

  private lerpShadows(a: Float32Array, b: Float32Array, k: number): Float32Array {
    if (this.out.length !== b.length) this.out = new Float32Array(b.length);
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < b.length; i++) this.out[i] = i < n ? a[i]! + (b[i]! - a[i]!) * k : b[i]!;
    return this.out;
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function lerpAngle(a: number, b: number, k: number): number { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * k; }

export function lerpView(a: ArenaView, b: ArenaView, k: number): ArenaView {
  return {
    ...b,
    tops: b.tops.map((t, i) => { const p = a.tops[i] ?? t; return { ...t, x: lerp(p.x, t.x, k), y: lerp(p.y, t.y, k), z: lerp(p.z, t.z, k), spin: lerp(p.spin, t.spin, k) }; }),
    mech: { ...b.mech, x: lerp(a.mech.x, b.mech.x, k), y: lerp(a.mech.y, b.mech.y, k), z: lerp(a.mech.z, b.mech.z, k), yaw: lerpAngle(a.mech.yaw, b.mech.yaw, k) },
  };
}
