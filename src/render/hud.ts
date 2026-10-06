import type { ArenaView } from '../sim/arena.ts';
import { formatTime, SECTIONS } from '../sim/rules.ts';
import { MECH } from '../tuning.ts';
import type { Lobby } from '../net/protocol.ts';
import { lookColor } from './models.ts';

export const KIT_NAMES = {
  boost: 'Boost', blink: 'Blink', phase: 'Phase', jump: 'Jump', hover: 'Hover', cloak: 'Cloak', parry: 'Parry', shield: 'Shield', lock: 'Lock',
} as const;
export const ABILITY_NAMES = { dash: 'Dash', empower: 'Empower', whirlpool: 'Whirlpool', leap: 'Leap' } as const;
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
    const k = m.kit;
    this.abilities.innerHTML =
      ability('Shift', KIT_NAMES[k.move], m.cd.move, m.cdMax.move, m.power.move > 0) +
      ability(k.air === 'hover' ? 'Hold Space' : 'Space', KIT_NAMES[k.air], m.hover ? 1 - m.fuel : m.cd.air, m.hover ? 1 : m.cdMax.air, m.power.air > 0) +
      ability('E', KIT_NAMES[k.guard], m.cd.guard, m.cdMax.guard, m.power.guard > 0);
    for (const [s, slot] of [['front', k.guard], ['rear', k.air], ['left', k.move], ['right', k.move]] as const) {
      document.querySelector<HTMLElement>(`#sections [data-s="${s}"] i`)!.textContent = s === 'left' || s === 'right' ? `Speed · ${KIT_NAMES[slot]}` : KIT_NAMES[slot];
    }
    this.slows.textContent = !m.control ? 'Knocked back!' : m.slows ? `Slowed ×${m.slows}` : '';

    const names = new Map(lobby.players.map(p => [p.id, p]));
    this.topPanel.innerHTML = `<div class="title">Tops <span>${view.shadows} shadows</span></div>` + view.tops.map((t, i) => {
      const id = lobby.tops[i] ?? '', p = names.get(id), color = hex(p ? lookColor(p.look) : 0xffffff);
      const ready = 1 - t.dashCd / t.cdMax;
      return `<div class="topRow ${id === selfId ? 'me' : ''}"><span class="dot" style="background:${color}"></span><span>${esc(p?.name ?? 'Top')} · ${ABILITY_NAMES[t.ability]}${t.empowered ? ' ⚡' : ''}${t.locked ? ' ❄' : ''}${t.stunned ? ' 💫' : ''}${t.out ? ' (fell)' : ''}${p && !p.connected ? ' (away)' : ''}</span><div class="bar"><i style="width:${ready * 100}%;background:${color}"></i></div></div>`;
    }).join('') + (lobby.tops.includes(selfId) ? `<p class="tag"><span class="kbd">Q</span> your ability</p>` : '');
  }
}

export function scoreList(el: HTMLElement, lobby: Lobby, highlight = -1): void {
  const list = lobby.scores[lobby.map] ?? [];
  el.innerHTML = list.length ? list.map((s, i) =>
    `<li class="${i === highlight ? 'mine' : ''}">${formatTime(s.time)} — ${esc(s.name)} vs ${s.tops} top${s.tops === 1 ? '' : 's'} <span class="when">${esc(s.date)}</span></li>`).join('') : '<li>No runs yet.</li>';
}
export { esc };
