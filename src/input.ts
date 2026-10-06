import type { MechInput, TopInput } from './sim/arena.ts';
import { TouchStick } from './touch-stick.ts';

/**
 * Keyboard, mouse and touch state. Button presses are counters, so a fast tap is never lost between
 * input messages. The camera looks north, so W (or the stick pushed up) moves toward −Z.
 *
 * Touch: the left half of the screen is a floating move stick; buttons at the bottom right press the
 * abilities. No mouse is needed on any device: abilities aim where you move (see aim).
 */
export class Controls {
  private keys = new Set<string>();
  private count = { dash: 0, boost: 0, jump: 0, parry: 0 };
  private airTouch = false;
  private stick: TouchStick;
  /** True after the last input came from a touch screen. */
  touch = matchMedia('(pointer: coarse)').matches;
  private lastDir = { x: 0, z: -1 };
  enabled = false;

  constructor(target: HTMLElement) {
    document.body.classList.toggle('touch', this.touch);
    window.addEventListener('keydown', e => {
      if (!this.enabled || e.target instanceof HTMLInputElement) return;
      const k = e.code;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyQ', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.setTouch(false);
      this.keys.add(k);
      if (k === 'KeyQ') this.count.dash++;
      if (k === 'ShiftLeft' || k === 'ShiftRight') this.count.boost++;
      if (k === 'Space') this.count.jump++;
      if (k === 'KeyE') this.count.parry++;
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.stick.reset(); this.airTouch = false; });
    window.addEventListener('pointerdown', e => this.setTouch(e.pointerType === 'touch'), { capture: true });
    target.addEventListener('pointerdown', e => {
      if (!this.enabled || e.pointerType !== 'mouse') return;
      if (e.button === 0) this.count.dash++;
      if (e.button === 2) this.count.parry++;
    });
    target.addEventListener('contextmenu', e => e.preventDefault());

    this.stick = new TouchStick(document.getElementById('stick')!, () => this.enabled, { floatingSurface: target, responseExponent: 1.4 });
    for (const b of document.querySelectorAll<HTMLElement>('[data-act]')) {
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (!this.enabled) return;
        const act = b.dataset.act!;
        if (act === 'dash') this.count.dash++;
        if (act === 'move') this.count.boost++;
        if (act === 'guard') this.count.parry++;
        if (act === 'air') { this.count.jump++; this.airTouch = true; b.setPointerCapture(e.pointerId); }
      });
      const release = () => { if (b.dataset.act === 'air') this.airTouch = false; };
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('contextmenu', e => e.preventDefault());
    }
  }

  /** Restarts the press counters at a new round, so a count from the round before never looks like a new press. */
  resetPresses(): void { this.count = { dash: 0, boost: 0, jump: 0, parry: 0 }; }

  private setTouch(on: boolean): void {
    if (on === this.touch) return;
    this.touch = on;
    document.body.classList.toggle('touch', on);
  }

  private move(): { mx: number; mz: number } {
    if (this.touch) return { mx: this.stick.x, mz: this.stick.y };
    const k = this.keys;
    const x = Number(k.has('KeyD') || k.has('ArrowRight')) - Number(k.has('KeyA') || k.has('ArrowLeft'));
    const z = Number(k.has('KeyS') || k.has('ArrowDown')) - Number(k.has('KeyW') || k.has('ArrowUp'));
    const len = Math.hypot(x, z) || 1;
    return { mx: x / len, mz: z / len };
  }

  /** No mouse is needed: abilities aim where you move, at a point ahead of `from` in the last move direction. */
  aim(from: { x: number; z: number }, reach = 12): { x: number; z: number } {
    const { mx, mz } = this.move(), len = Math.hypot(mx, mz);
    if (len > 0.25) this.lastDir = { x: mx / len, z: mz / len };
    return { x: from.x + this.lastDir.x * reach, z: from.z + this.lastDir.z * reach };
  }

  top(aim: { x: number; z: number }): TopInput {
    return { ...(this.enabled ? this.move() : { mx: 0, mz: 0 }), ax: aim.x, az: aim.z, dash: this.count.dash };
  }
  mech(aim: { x: number; z: number }): MechInput {
    return {
      ...(this.enabled ? this.move() : { mx: 0, mz: 0 }), ax: aim.x, az: aim.z,
      boost: this.count.boost, jump: this.count.jump, parry: this.count.parry,
      airHeld: this.enabled && (this.keys.has('Space') || this.airTouch),
    };
  }
}

/**
 * A second top on the same keyboard: I, J, K and L move, and U or O dashes (U mirrors Q on the right hand;
 * O is there for players who prefer it). It aims the same way as the first player: where it moves.
 */
export class SecondControls {
  private keys = new Set<string>();
  private dash = 0;
  private lastDir = { x: 0, z: -1 };
  enabled = false;
  constructor() {
    window.addEventListener('keydown', e => {
      if (!this.enabled || e.target instanceof HTMLInputElement || e.repeat) return;
      if (['KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyU', 'KeyO'].includes(e.code)) { e.preventDefault(); this.keys.add(e.code); }
      if (e.code === 'KeyU' || e.code === 'KeyO') this.dash++;
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  resetPresses(): void { this.dash = 0; }
  private move(): { mx: number; mz: number } {
    const k = this.keys;
    const x = Number(k.has('KeyL')) - Number(k.has('KeyJ')), z = Number(k.has('KeyK')) - Number(k.has('KeyI'));
    const len = Math.hypot(x, z) || 1;
    return this.enabled ? { mx: x / len, mz: z / len } : { mx: 0, mz: 0 };
  }
  top(from: { x: number; z: number }): TopInput {
    const m = this.move(), len = Math.hypot(m.mx, m.mz);
    if (len > 0.25) this.lastDir = { x: m.mx / len, z: m.mz / len };
    return { ...m, ax: from.x + this.lastDir.x * 12, az: from.z + this.lastDir.z * 12, dash: this.dash };
  }
}
