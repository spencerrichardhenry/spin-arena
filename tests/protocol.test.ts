import { describe, expect, it } from 'vitest';
import { canStart, chooseTeam, cleanName, packShadows, readMechInput, readTopInput, unpackShadows, validCode, makeCode, type LobbyPlayer } from '../src/net/protocol.ts';
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
  it('makes valid room codes', () => { for (let i = 0; i < 50; i++) expect(validCode(makeCode())).toBe(true); });
  it('allows one mech and up to four tops', () => {
    const players: LobbyPlayer[] = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, name: id, team: 'watch', connected: true, host: false }));
    expect(chooseTeam(players, 'a', 'mech', 4)).toBe(true);
    expect(chooseTeam(players, 'b', 'mech', 4)).toBe(false);
    expect(canStart(players)).toBe(false);
    for (const id of ['b', 'c', 'd', 'e']) expect(chooseTeam(players, id, 'top', 4)).toBe(true);
    expect(chooseTeam(players, 'f', 'top', 4)).toBe(false);
    expect(canStart(players)).toBe(true);
    expect(chooseTeam(players, 'a', 'top', 4)).toBe(false);
    expect(chooseTeam(players, 'a', 'watch', 4)).toBe(true);
    expect(canStart(players)).toBe(false);
  });
  it('interpolates positions and turns the short way', () => {
    const base = { clock: 0, over: false, shadows: 0, dashCooldown: 5.5, shadowEpoch: 0, tops: [{ x: 0, y: 0, z: 0, spin: 0, dashing: false, dashCd: 0 }],
      mech: { x: 0, y: 1, z: 0, yaw: 3.0, air: false, parry: false, boost: false, control: true, health: 12, hits: { front: 0, rear: 0, left: 0, right: 0 }, slows: 0, cd: { boost: 0, jump: 0, parry: 0 }, power: { boost: 1, jump: 1, parry: 1 } } };
    const next = { ...base, tops: [{ ...base.tops[0]!, x: 10 }], mech: { ...base.mech, x: 4, yaw: -3.0 } };
    const mid = lerpView(base, next, 0.5);
    expect(mid.tops[0]!.x).toBe(5);
    expect(mid.mech.x).toBe(2);
    expect(Math.abs(Math.cos(mid.mech.yaw) - Math.cos(Math.PI))).toBeLessThan(0.01);
  });
});
