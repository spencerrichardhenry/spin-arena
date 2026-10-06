import { describe, expect, it } from 'vitest';
import { canStart, chooseTeam, notReady, type Team, DEFAULT_KIT, defaultLook, readLook, readKit, cleanName, packShadows, readMechInput, readTopInput, unpackShadows, validCode, makeCode, type LobbyPlayer } from '../src/net/protocol.ts';
import { lerpView } from '../src/session.ts';

describe('protocol', () => {
  it('packs shadow positions to 1 cm precision', () => {
    const src = new Float32Array([1.234, -17.991, 5.5, 0, 12.345, -0.004]);
    const back = unpackShadows(packShadows(src));
    src.forEach((v, i) => expect(Math.abs(back[i]! - v)).toBeLessThanOrEqual(0.005 + 1e-6));
    expect(packShadows(new Float32Array(1500)).byteLength).toBe(3000);
  });
  it('rejects invalid inputs', () => {
    expect(readTopInput({ mx: 1, mz: 0, ax: 3, az: 4, dash: 2 })).toEqual({ mx: 1, mz: 0, ax: 3, az: 4, dash: 2 });
    expect(readTopInput({ mx: 5, mz: 0, ax: 3, az: 4, dash: 2 })).toBeNull();
    expect(readTopInput({ mx: 0, mz: 0, ax: NaN, az: 4, dash: 2 })).toBeNull();
    expect(readTopInput({ mx: 0, mz: 0, ax: 0, az: 4, dash: -1 })).toBeNull();
    expect(readMechInput({ mx: 0, mz: 0, ax: 0, az: 0, boost: 1, jump: 1 })).toBeNull();
    expect(readMechInput('hello')).toBeNull();
    expect(cleanName('<b>Ava</b>!!')).toBe('bAvab');
    expect(cleanName('')).toBe('Player');
  });
  it('checks loadouts', () => {
    expect(readKit({ move: 'blink', air: 'hover', guard: 'shield' })).toEqual({ move: 'blink', air: 'hover', guard: 'shield' });
    expect(readKit({ move: 'fly', air: 'hover', guard: 'shield' })).toBeNull();
    expect(readLook({ top: 3, mid: 0, bot: 2 })).toEqual({ top: 3, mid: 0, bot: 2 });
    expect(readLook({ top: 4, mid: 0, bot: 2 })).toBeNull();
    expect(readLook({ top: 1.5, mid: 0, bot: 2 })).toBeNull();
    expect(readMechInput({ mx: 0, mz: 0, ax: 0, az: 0, boost: 1, jump: 1, parry: 0, airHeld: 'yes' })).toBeNull();
  });
  it('makes valid room codes', () => { for (let i = 0; i < 50; i++) expect(validCode(makeCode())).toBe(true); });
  it('allows one mech and up to four tops', () => {
    const players: LobbyPlayer[] = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, name: id, team: 'watch', connected: true, host: false, ready: true, kit: DEFAULT_KIT, look: defaultLook(0) }));
    expect(chooseTeam(players, 'a', 'mech', 4)).toBe(true);
    expect(chooseTeam(players, 'b', 'mech', 4)).toBe(false);
    expect(canStart(players)).toBe(false);
    for (const id of ['b', 'c', 'd', 'e']) expect(chooseTeam(players, id, 'top', 4)).toBe(true);
    expect(chooseTeam(players, 'f', 'top', 4)).toBe(false);
    for (const p of players) p.ready = true; // a team change resets ready
    expect(canStart(players)).toBe(true);
    expect(chooseTeam(players, 'a', 'top', 4)).toBe(false);
    expect(chooseTeam(players, 'a', 'watch', 4)).toBe(true);
    expect(canStart(players)).toBe(false);
  });
  it('starts only when every player is ready; a team change resets ready', () => {
    const p = (id: string, team: Team, extra: Partial<LobbyPlayer> = {}): LobbyPlayer =>
      ({ id, name: id, team, connected: true, host: false, ready: false, kit: DEFAULT_KIT, look: defaultLook(0), ...extra });
    const players = [p('host', 'mech'), p('kid', 'top'), p('kid~2', 'top'), p('bot-1', 'top', { bot: true }), p('dad', 'watch')];
    expect(canStart(players)).toBe(false);
    expect(notReady(players).map(x => x.id)).toEqual(['host', 'kid', 'kid~2', 'dad']);
    players[1]!.ready = true; // the second keyboard player follows its owner
    expect(notReady(players).map(x => x.id)).toEqual(['host', 'dad']);
    players[0]!.ready = true; players[4]!.ready = true;
    expect(canStart(players)).toBe(true);
    expect(chooseTeam(players, 'dad', 'top', 4)).toBe(true);
    expect(players[4]!.ready).toBe(false);
    expect(canStart(players)).toBe(false);
  });
  it('interpolates positions and turns the short way', () => {
    const base = { clock: 0, over: false, shadows: 0, dashCooldown: 5.5, shadowEpoch: 0, vortices: [], tops: [{ x: 0, y: 0, z: 0, spin: 0, dashing: false, dashCd: 0, cdMax: 5.5, ability: 'dash' as const, empowered: false, locked: false, stunned: false, out: false }],
      mech: { x: 0, y: 1, z: 0, yaw: 3.0, kit: DEFAULT_KIT, air: false, hover: false, parry: false, shield: false, boost: false, control: true, health: 12, hits: { front: 0, rear: 0, left: 0, right: 0 }, slows: 0,
        cd: { move: 0, air: 0, guard: 0 }, cdMax: { move: 4, air: 7, guard: 9 }, power: { move: 1, air: 1, guard: 1 }, fuel: 1, cloak: false } };
    const next = { ...base, tops: [{ ...base.tops[0]!, x: 10 }], mech: { ...base.mech, x: 4, yaw: -3.0 } };
    const mid = lerpView(base, next, 0.5);
    expect(mid.tops[0]!.x).toBe(5);
    expect(mid.mech.x).toBe(2);
    expect(Math.abs(Math.cos(mid.mech.yaw) - Math.cos(Math.PI))).toBeLessThan(0.01);
  });
});
