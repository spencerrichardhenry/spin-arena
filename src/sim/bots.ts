import type { ArenaView, MechInput, TopInput } from './arena.ts';
import { BUILDINGS, pushOutOfBox, pushOutOfTree, TREES, WALLS } from './city.ts';
import { forward } from './rules.ts';

/** Practice bots. They read the same view that players see and produce ordinary inputs. */

/** A steering push away from nearby buildings, walls and trunks, so bots do not stick to them. */
function avoid(x: number, z: number, range: number): [number, number] {
  let ax = 0, az = 0;
  for (const b of [...BUILDINGS, ...WALLS]) { const h = pushOutOfBox(b, x, z, range); if (h) { ax += h.nx; az += h.nz; } }
  for (const t of TREES) { const h = pushOutOfTree(t, x, z, range * 0.6); if (h) { ax += h.nx; az += h.nz; } }
  return [ax, az];
}

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
    const [ox, oz] = avoid(me.x, me.z, 2.5);
    let mx = gx - me.x, mz = gz - me.z;
    const len = Math.hypot(mx, mz) || 1;
    mx = mx / len + ox * 1.5; mz = mz / len + oz * 1.5;
    const l2 = Math.hypot(mx, mz) || 1;
    this.wait -= dt;
    const dist = Math.hypot(m.x - me.x, m.z - me.z);
    if (this.wait <= 0 && me.dashCd <= 0 && dist < 10 && !m.air) { this.dash++; this.wait = 1.2; }
    return { mx: mx / l2, mz: mz / l2, ax: m.x, az: m.z, dash: this.dash };
  }
}

export class MechBot {
  private ids = { boost: 0, jump: 0, parry: 0 };
  private hold = 0;
  input(view: ArenaView): MechInput {
    const m = view.mech;
    let ax = 0, az = 0, near = 0, closest = Infinity, cx = 0, cz = 0;
    for (const t of view.tops) {
      const dx = t.x - m.x, dz = t.z - m.z, d = Math.hypot(dx, dz) || 1;
      ax -= dx / d / d; az -= dz / d / d;
      if (d < 5) near++;
      if (d < closest) { closest = d; cx = t.x; cz = t.z; }
    }
    // Drift toward the centre and away from obstacles.
    const [ox, oz] = avoid(m.x, m.z, 3.5);
    ax += -m.x * 0.004 + ox * 0.3; az += -m.z * 0.004 + oz * 0.3;
    const len = Math.hypot(ax, az) || 1;
    if (closest < 4 && m.cd.guard <= 0) this.ids.parry++;
    else if (near >= 2 && m.cd.air <= 0) { this.ids.jump++; this.hold = 90; }
    else if (closest < 7 && m.cd.move <= 0) this.ids.boost++;
    this.hold = Math.max(0, this.hold - 1);
    const escape = { x: m.x + (ax / len) * 8, z: m.z + (az / len) * 8 };
    const aim = near >= 2 || m.kit.move === 'blink' ? escape : { x: cx, z: cz };
    return { mx: ax / len, mz: az / len, ax: aim.x, az: aim.z, ...this.ids, airHeld: this.hold > 0 };
  }
}
