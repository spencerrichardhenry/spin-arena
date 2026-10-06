import type { GameEvent } from './sim/arena.ts';

/** Small synthesized sounds, so the game needs no audio files. */
let ctx: AudioContext | null = null;
export function unlockAudio(): void {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, to: number, time: number, type: OscillatorType, volume: number): void {
  if (!ctx) return;
  const t = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + time);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + time);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t); osc.stop(t + time);
}

export function playEvents(events: readonly GameEvent[]): void {
  let shadowHits = 0, pops = 0;
  for (const e of events) {
    switch (e.k) {
      case 'hit': tone(e.damage > 1 ? 120 : 180, 50, 0.3, 'square', 0.25); tone(900, 300, 0.12, 'sawtooth', 0.12); break;
      case 'shadowHit': if (shadowHits++ < 2) tone(420, 200, 0.12, 'triangle', 0.12); break;
      case 'pop': if (pops++ < 3) tone(900 + pops * 150, 1800, 0.12, 'sine', 0.1); break;
      case 'dash': tone(300, 1200, 0.18, 'sawtooth', 0.08); break;
      case 'shadow': tone(520, 130, 0.35, 'sine', 0.1); break;
      case 'parry': tone(120, 900, 0.3, 'square', 0.18); break;
      case 'jump': tone(200, 600, 0.4, 'sawtooth', 0.1); break;
      case 'land': tone(140, 40, 0.3, 'square', 0.2); break;
      case 'boost': tone(250, 700, 0.2, 'triangle', 0.12); break;
      case 'empower': tone(500, 1500, 0.25, 'square', 0.1); break;
      case 'whirlpool': tone(700, 150, 0.6, 'sine', 0.14); break;
      case 'leap': tone(260, 900, 0.25, 'triangle', 0.12); break;
      case 'lock': tone(1400, 900, 0.3, 'sine', 0.16); break;
      case 'cloak': tone(600, 80, 0.5, 'sine', 0.1); break;
      case 'phase': tone(1200, 200, 0.3, 'sawtooth', 0.1); break;
      case 'block': tone(800, 400, 0.15, 'square', 0.12); break;
      case 'saw': tone(1800, 600, 0.15, 'sawtooth', 0.1); break;
      case 'bump': tone(600, 1200, 0.12, 'square', 0.12); break;
      case 'fall': tone(500, 80, 0.6, 'sine', 0.14); break;
      case 'respawn': tone(300, 900, 0.2, 'triangle', 0.1); break;
      case 'over': tone(400, 50, 1.2, 'sawtooth', 0.25); break;
    }
  }
}
