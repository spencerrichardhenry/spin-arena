import type { MechInput, TopInput } from './sim/arena.ts';

/**
 * Keyboard and mouse state. Button presses are counters, so a fast tap is never lost between
 * input messages. The camera looks north, so W moves toward −Z.
 */
export class Controls {
  private keys = new Set<string>();
  private mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  private count = { dash: 0, boost: 0, jump: 0, parry: 0 };
  enabled = false;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', e => {
      if (!this.enabled || e.target instanceof HTMLInputElement) return;
      const k = e.code;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyQ', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (k === 'KeyQ') this.count.dash++;
      if (k === 'ShiftLeft' || k === 'ShiftRight') this.count.boost++;
      if (k === 'Space') this.count.jump++;
      if (k === 'KeyE') this.count.parry++;
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointermove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    target.addEventListener('pointerdown', e => {
      if (!this.enabled) return;
      if (e.button === 0) this.count.dash++;
      if (e.button === 2) this.count.parry++;
    });
    target.addEventListener('contextmenu', e => e.preventDefault());
  }

  private move(): { mx: number; mz: number } {
    const k = this.keys;
    const x = Number(k.has('KeyD') || k.has('ArrowRight')) - Number(k.has('KeyA') || k.has('ArrowLeft'));
    const z = Number(k.has('KeyS') || k.has('ArrowDown')) - Number(k.has('KeyW') || k.has('ArrowUp'));
    const len = Math.hypot(x, z) || 1;
    return { mx: x / len, mz: z / len };
  }
  get pointer(): { x: number; y: number } { return this.mouse; }

  top(aim: { x: number; z: number }): TopInput {
    return { ...(this.enabled ? this.move() : { mx: 0, mz: 0 }), ax: aim.x, az: aim.z, dash: this.count.dash };
  }
  mech(aim: { x: number; z: number }): MechInput {
    return {
      ...(this.enabled ? this.move() : { mx: 0, mz: 0 }), ax: aim.x, az: aim.z,
      boost: this.count.boost, jump: this.count.jump, parry: this.count.parry, airHeld: this.enabled && this.keys.has('Space'),
    };
  }
}
