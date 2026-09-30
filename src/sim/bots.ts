import type { ArenaView, MechInput, TopInput } from './arena.ts';
import { forward } from './rules.ts';

/** Practice bots. They read the same view that players see and produce ordinary inputs. */

export class TopBot {
  private dash = 0;
  private wait: number;
  constructor(private readonly index: number) { this.wait = 1 + index * 0.7; }
  input(view: ArenaView, dt: number): TopInput {
    const me = view.tops[this.index], m = view.mech;
    if (!me) return { mx: 0, mz: 0, ax: 0, az: 0, dash: this.dash };
    // Circle to a point behind the mech, then dash through it.
    const [fx, fz] = forward(m.yaw);
    const side = this.index % 2 ? 1 : -1;
    const gx = m.x - fx * 7 + fz * side * 3, gz = m.z - fz * 7 - fx * side * 3;
    let mx = gx - me.x, mz = gz - me.z;
    const len = Math.hypot(mx, mz) || 1;
    mx /= len; mz /= len;
    this.wait -= dt;
    const dist = Math.hypot(m.x - me.x, m.z - me.z);
    if (this.wait <= 0 && me.dashCd <= 0 && dist < 10 && !m.air) { this.dash++; this.wait = 1.2; }
    return { mx, mz, ax: m.x, az: m.z, dash: this.dash };
  }
}

export class MechBot {
  private ids = { boost: 0, jump: 0, parry: 0 };
  input(view: ArenaView): MechInput {
    const m = view.mech;
    let ax = 0, az = 0, near = 0, closest = Infinity, cx = 0, cz = 0;
    for (const t of view.tops) {
      const dx = t.x - m.x, dz = t.z - m.z, d = Math.hypot(dx, dz) || 1;
      ax -= dx / d / d; az -= dz / d / d;
      if (d < 5) near++;
      if (d < closest) { closest = d; cx = t.x; cz = t.z; }
    }
    // Drift toward the centre so it does not sit on the rim.
    ax -= m.x * 0.01; az -= m.z * 0.01;
    const len = Math.hypot(ax, az) || 1;
    if (closest < 4 && m.cd.parry <= 0) this.ids.parry++;
    else if (near >= 2 && m.cd.jump <= 0) this.ids.jump++;
    else if (closest < 7 && m.cd.boost <= 0) this.ids.boost++;
    const jumpTo = near >= 2 ? { x: -m.x * 0.5 + ax / len * 8, z: -m.z * 0.5 + az / len * 8 } : { x: cx, z: cz };
    return { mx: ax / len, mz: az / len, ax: jumpTo.x, az: jumpTo.z, ...this.ids };
  }
}
