import { describe, expect, it } from 'vitest';
import {
  applySawHit, applyShadowHit, applyTopHit, baseSpeed, boostFactor, broken, createMechStatus, dead, formatTime, hasControl,
  hitSection, insertScore, jumpRange, parryRadius, slowFactor, type ScoreEntry,
} from '../src/sim/rules.ts';
import { MECH } from '../src/tuning.ts';

describe('hitSection', () => {
  it('maps offsets to the four 90° sections when facing +Z', () => {
    expect(hitSection(0, 0, 1)).toBe('front');
    expect(hitSection(0, 0, -1)).toBe('rear');
    expect(hitSection(0, -1, 0)).toBe('right');
    expect(hitSection(0, 1, 0)).toBe('left');
    expect(hitSection(0, 0.9, 1)).toBe('front');
    expect(hitSection(0, 1, 0.9)).toBe('left');
  });
  it('rotates with the mech', () => {
    const yaw = Math.PI / 2; // facing +X
    expect(hitSection(yaw, 1, 0)).toBe('front');
    expect(hitSection(yaw, -1, 0)).toBe('rear');
    expect(hitSection(yaw, 0, 1)).toBe('right');
    expect(hitSection(yaw, 0, -1)).toBe('left');
  });
});

describe('top hits', () => {
  it('breaks a section after three hits and ends the run after twelve', () => {
    const s = createMechStatus();
    let t = 0;
    for (let i = 0; i < 3; i++) { expect(applyTopHit(s, 'front', t)).toBe(true); t += 1; }
    expect(broken(s, 'front')).toBe(true);
    expect(parryRadius(s)).toBe(0);
    expect(s.health).toBe(9);
    for (let i = 0; i < 9; i++) { applyTopHit(s, 'front', t); t += 1; }
    expect(s.hits.front).toBe(3);
    expect(dead(s)).toBe(true);
    expect(applyTopHit(s, 'rear', t + 5)).toBe(false);
  });
  it('ignores hits during immunity', () => {
    const s = createMechStatus();
    expect(applyTopHit(s, 'left', 0)).toBe(true);
    expect(applyTopHit(s, 'right', MECH.topHitImmunity - 0.01)).toBe(false);
    expect(applyTopHit(s, 'right', MECH.topHitImmunity)).toBe(true);
    expect(s.health).toBe(10);
  });
  it('weakens powers per section', () => {
    const s = createMechStatus();
    applyTopHit(s, 'rear', 0);
    expect(jumpRange(s)).toBeCloseTo(MECH.jumpRange * 0.75);
    applyTopHit(s, 'front', 1);
    expect(parryRadius(s)).toBeCloseTo(MECH.parryRadius * 0.8);
    applyTopHit(s, 'left', 2);
    expect(baseSpeed(s)).toBeCloseTo(MECH.speed * (1 - MECH.legHitSpeedLoss));
    expect(boostFactor(s)).toBeCloseTo(MECH.boostFactor);
    applyTopHit(s, 'left', 3); applyTopHit(s, 'left', 4);
    expect(boostFactor(s)).toBeCloseTo(1 + (MECH.boostFactor - 1) / 2);
    for (let i = 0; i < 3; i++) applyTopHit(s, 'right', 5 + i);
    expect(boostFactor(s)).toBe(0);
    applyTopHit(s, 'rear', 9); applyTopHit(s, 'rear', 10);
    expect(jumpRange(s)).toBe(0);
  });
});

describe('shadow hits', () => {
  it('a saw pushes like a shadow but does not slow, and shares the push immunity', () => {
    const s = createMechStatus();
    expect(applySawHit(s, 1).pushed).toBe(true);
    expect(s.slows).toHaveLength(0);
    expect(hasControl(s, 1.1)).toBe(false);
    expect(applySawHit(s, 1.5).pushed).toBe(false);
    expect(s.health).toBe(MECH.health);
  });
  it('always stacks slows but pushes only outside push immunity', () => {
    const s = createMechStatus();
    expect(applyShadowHit(s, 0).pushed).toBe(true);
    expect(hasControl(s, 0.1)).toBe(false);
    expect(hasControl(s, MECH.controlLoss)).toBe(true);
    expect(applyShadowHit(s, 0.5).pushed).toBe(false);
    expect(applyShadowHit(s, 1).pushed).toBe(false);
    expect(slowFactor(s, 1)).toBeCloseTo(1 - 3 * MECH.slowPerStack);
    expect(applyShadowHit(s, MECH.pushImmunity).pushed).toBe(true);
    expect(s.health).toBe(MECH.health);
  });
  it('expires stacks and respects the minimum speed', () => {
    const s = createMechStatus();
    for (let i = 0; i < 30; i++) applyShadowHit(s, 0);
    expect(slowFactor(s, 0.1)).toBe(MECH.minSpeedFactor);
    expect(slowFactor(s, MECH.slowDuration + 0.01)).toBe(1);
  });
});

describe('scores', () => {
  it('keeps the best times in order', () => {
    let list: ScoreEntry[] = [];
    for (let i = 0; i < 12; i++) list = insertScore(list, { name: `p${i}`, tops: 2, time: i * 10, date: '' }, 10).list;
    expect(list).toHaveLength(10);
    expect(list[0]!.time).toBe(110);
    const slow = insertScore(list, { name: 'x', tops: 1, time: 1, date: '' }, 10);
    expect(slow.rank).toBe(-1);
    const best = insertScore(list, { name: 'y', tops: 1, time: 500, date: '' }, 10);
    expect(best.rank).toBe(0);
    expect(formatTime(75.25)).toBe('1:15.3');
  });
});
