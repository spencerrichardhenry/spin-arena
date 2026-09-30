import type { ArenaView } from '../sim/arena.ts';
import { formatTime, SECTIONS } from '../sim/rules.ts';
import { MECH } from '../tuning.ts';
import type { Lobby } from '../net/protocol.ts';
import { TOP_COLORS } from './models.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export class Hud {
  private timer = $('timer');
  private countdown = $('countdown');
  private health = $('health');
  private healthBar = $('healthBar');
  private abilities = $('abilities');
  private slows = $('slows');
  private topPanel = $('topPanel');
  private pips: HTMLElement[] = [];

  constructor() {
    for (let i = 0; i < MECH.health; i++) { const pip = document.createElement('i'); this.healthBar.append(pip); this.pips.push(pip); }
  }

  update(view: ArenaView, lobby: Lobby, selfId: string): void {
    const m = view.mech;
    this.timer.textContent = formatTime(Math.max(0, view.clock));
    this.countdown.textContent = view.clock < 0 ? String(Math.ceil(-view.clock)) : view.clock < 0.8 ? 'GO!' : '';
    this.health.textContent = `${m.health} / ${MECH.health}`;
    this.pips.forEach((p, i) => p.classList.toggle('gone', i >= m.health));
    for (const s of SECTIONS) {
      const el = document.querySelector<HTMLElement>(`#sections [data-s="${s}"]`)!;
      const hits = m.hits[s], broken = hits >= MECH.plates;
      el.classList.toggle('broken', broken);
      el.querySelector('span')!.textContent = broken ? 'BROKEN' : '■'.repeat(MECH.plates - hits) + '□'.repeat(hits);
    }
    const ability = (key: string, name: string, cd: number, max: number, on: boolean) =>
      `<div class="ability ${on ? '' : 'off'}"><span><span class="kbd">${key}</span> ${name}</span><div class="bar"><i style="width:${on ? (1 - cd / max) * 100 : 0}%"></i></div></div>`;
    this.abilities.innerHTML =
      ability('Shift', 'Boost', m.cd.boost, MECH.boostCooldown, m.power.boost > 0) +
      ability('Space', 'Jump', m.cd.jump, MECH.jumpCooldown, m.power.jump > 0) +
      ability('RMB', 'Parry', m.cd.parry, MECH.parryCooldown, m.power.parry > 0);
    this.slows.textContent = !m.control ? 'Knocked back!' : m.slows ? `Slowed ×${m.slows}` : '';

    const names = new Map(lobby.players.map(p => [p.id, p]));
    this.topPanel.innerHTML = `<div class="title">Tops <span>${view.shadows} shadows</span></div>` + view.tops.map((t, i) => {
      const id = lobby.tops[i] ?? '', p = names.get(id), color = hex(TOP_COLORS[i % 4]!);
      const ready = 1 - t.dashCd / view.dashCooldown;
      return `<div class="topRow ${id === selfId ? 'me' : ''}"><span class="dot" style="background:${color}"></span><span>${esc(p?.name ?? 'Top')}${p && !p.connected ? ' (away)' : ''}</span><div class="bar"><i style="width:${ready * 100}%;background:${color}"></i></div></div>`;
    }).join('') + `<p class="tag">Dash cooldown ${view.dashCooldown.toFixed(1)} s${lobby.tops.includes(selfId) ? ' · <span class="kbd">Q</span> dash toward the mouse' : ''}</p>`;
  }
}

export function scoreList(el: HTMLElement, lobby: Lobby, highlight = -1): void {
  el.innerHTML = lobby.scores.length ? lobby.scores.map((s, i) =>
    `<li class="${i === highlight ? 'mine' : ''}">${formatTime(s.time)} — ${esc(s.name)} vs ${s.tops} top${s.tops === 1 ? '' : 's'} <span class="when">${esc(s.date)}</span></li>`).join('') : '<li>No runs yet.</li>';
}
export { esc };
