import { initPhysics } from './sim/arena.ts';
import { Scene } from './render/scene.ts';
import { Hud, KIT_NAMES, scoreList, esc } from './render/hud.ts';
import type { ArenaView } from './sim/arena.ts';
import { Preview } from './render/preview.ts';
import { DESIGN_NAMES } from './render/models.ts';
import { Controls } from './input.ts';
import { playEvents, unlockAudio } from './audio.ts';
import { Room } from './net/room.ts';
import { defaultLook, displayCode, normalizeCode, PART_COUNT, type Team, type TopLook } from './net/protocol.ts';
import { DEFAULT_KIT, type MechKit } from './sim/rules.ts';
import { formatTime } from './sim/rules.ts';
import { GuestSession, HostSession, type Session } from './session.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const scene = new Scene(canvas);
const hud = new Hud();
const controls = new Controls(canvas);
const room = new Room();
const preview = new Preview($<HTMLCanvasElement>('preview'));
let session: Session | null = null;

function playerId(): string {
  // Per tab, so two tabs on one computer are two players; a reload keeps the same slot.
  try {
    let id = sessionStorage.getItem('spin-arena-id');
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('spin-arena-id', id); }
    return id;
  } catch { return crypto.randomUUID(); }
}
const selfId = playerId();
const nameInput = $<HTMLInputElement>('name');
try { nameInput.value = localStorage.getItem('spin-arena-name') ?? ''; } catch { /* storage unavailable */ }
const myName = () => { const n = nameInput.value.trim() || 'Player'; try { localStorage.setItem('spin-arena-name', n); } catch { /* ignore */ } return n; };

const screens = ['home', 'lobby', 'hud', 'over'] as const;
function show(which: (typeof screens)[number] | 'none'): void { for (const s of screens) $(s).classList.toggle('hidden', s !== which && !(s === 'hud' && which === 'over')); }
function status(el: string, text: string, error = false): void { const e = $(el); e.textContent = text; e.classList.toggle('error', error); }

const joinFromLink = new URLSearchParams(location.hash.slice(1)).get('join');
if (joinFromLink) $<HTMLInputElement>('code').value = displayCode(normalizeCode(joinFromLink));

room.onStatus = () => {
  const bad = room.status === 'error';
  if (session && bad) {
    session = null;
    show('home');
  }
  status(session ? 'lobbyStatus' : 'homeStatus', room.message, bad);
  renderLobby();
};

$('create').onclick = async () => {
  unlockAudio();
  const host = new HostSession(selfId, myName(), room);
  session = host;
  host.onLobby = renderLobby;
  show('lobby');
  renderLobby();
  await room.host();
};
$('join').onclick = () => {
  unlockAudio();
  const code = $<HTMLInputElement>('code').value;
  const guest = new GuestSession(selfId, room);
  guest.onLobby = renderLobby;
  session = guest;
  room.join(code, selfId, myName());
  if (room.status === 'error') { session = null; return; }
  show('lobby');
  renderLobby();
};
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('join').click(); });
$('practice').onclick = () => {
  unlockAudio();
  room.stop();
  const host = new HostSession(selfId, myName(), null);
  session = host;
  host.onLobby = renderLobby;
  host.addBot('top'); host.addBot('top');
  show('lobby');
  renderLobby();
};
$('copy').onclick = async () => {
  const url = new URL(location.href); url.hash = `join=${room.code}`;
  try { await navigator.clipboard.writeText(url.href); status('lobbyStatus', 'Link copied.'); } catch { status('lobbyStatus', url.href); }
};
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-team]')) b.onclick = () => session?.setTeam(b.dataset.team as Team);
// Customization: the mech kit (one option per slot) and the top's three parts.
const KIT_HELP: Record<string, string> = {
  boost: 'Boost: a short burst of speed.', blink: 'Blink: teleport toward the mouse. It cannot pass buildings.',
  jump: 'Jump: leap to the mouse, over walls and tunnels.', hover: 'Hover: hold Space to fly low over walls and tunnels.',
  parry: 'Parry: a pulse that deletes shadows and throws tops away.', shield: 'Shield: 3 s of front armour; it deletes shadows that hit the front.',
};
let lastPick = 'boost';
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-pick]')) b.onclick = () => {
  const me = session?.lobby?.players.find(p => p.id === selfId);
  const slot = b.parentElement!.dataset.slot as keyof MechKit;
  lastPick = b.dataset.pick!;
  session?.setKit({ ...(me?.kit ?? DEFAULT_KIT), [slot]: b.dataset.pick } as MechKit);
};
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-step]')) b.onclick = () => {
  const me = session?.lobby?.players.find(p => p.id === selfId);
  const part = b.parentElement!.dataset.part as keyof TopLook, look = { ...(me?.look ?? defaultLook(0)) };
  look[part] = (look[part] + Number(b.dataset.step) + PART_COUNT) % PART_COUNT;
  session?.setLook(look);
};

$('botTop').onclick = () => (session as HostSession).addBot('top');
$('botMech').onclick = () => (session as HostSession).addBot('mech');
$('botClear').onclick = () => (session as HostSession).removeBots();
$('start').onclick = () => { unlockAudio(); (session as HostSession).start(); };
$('again').onclick = () => (session as HostSession).backToLobby();
$('leave').onclick = () => { room.stop(); session = null; show('home'); status('homeStatus', ''); };

const HELP: Record<Team, string> = {
  mech: '<h3>Mech controls</h3><p><kbd>WASD</kbd> move · mouse to face</p><p><kbd>Shift</kbd> legs ability · <kbd>Space</kbd> back ability</p><p><kbd>Right click</kbd> or <kbd>E</kbd> arms ability</p><p>Each side has 3 plates. 3 hits break a side and its ability. 12 hits end the run. Shadows only slow and push you.</p>',
  top: '<h3>Top controls</h3><p><kbd>WASD</kbd> move · <kbd>Q</kbd> or <kbd>click</kbd> dash toward the mouse</p><p>3 seconds after each dash, a shadow top replays it. Shadows never stop.</p><p>Hide under tunnels and trees. Hit the mech hard, on a damaged side.</p>',
  watch: '<h3>Watching</h3><p>Pick a team to play in the next round.</p>',
};

function renderLobby(): void {
  const s = session, lobby = s?.lobby;
  if (!s || !lobby) { if (s) { $('players').innerHTML = ''; } return; }
  const me = lobby.players.find(p => p.id === selfId);
  if (lobby.phase === 'lobby') show('lobby');
  else if (lobby.phase === 'playing') show('hud');
  else show('over');
  controls.enabled = lobby.phase === 'playing' && (me?.team === 'mech' || me?.team === 'top');

  const hosting = s.isHost, online = hosting ? room.status === 'open' : room.status === 'connected';
  $('lobbyTitle').textContent = hosting && !room.code ? 'Practice' : 'Lobby';
  $('invite').classList.toggle('hidden', !(hosting && room.code && room.isHost));
  $('roomCode').textContent = room.code ? displayCode(room.code) : '';
  $('players').innerHTML = lobby.players.map(p => `<li class="${p.connected ? '' : 'off'}">${esc(p.name)}${p.id === selfId ? ' <span class="me">you</span>' : ''}${p.host ? ' <span class="me">host</span>' : ''}<span class="team ${p.team}">${p.team === 'mech' ? 'Mech' : p.team === 'top' ? 'Top' : 'Watching'}</span></li>`).join('');
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-team]')) b.classList.toggle('selected', me?.team === b.dataset.team);
  $('hostTools').classList.toggle('hidden', !hosting);
  $('start').classList.toggle('hidden', !hosting);
  const host = hosting ? (s as HostSession) : null;
  ($('start') as HTMLButtonElement).disabled = !host?.canStart;
  if (hosting && !host?.canStart) status('lobbyStatus', 'To start, you need one mech and one to four tops.');
  else if (!hosting) status('lobbyStatus', online ? 'Waiting for the host to start.' : room.message, room.status === 'error');
  else if (online || !room.code) status('lobbyStatus', room.code ? 'Ready. Share the code, or start now.' : 'Ready.');
  $('help').innerHTML = HELP[me?.team ?? 'watch'];
  const team = me?.team ?? 'watch', kit = me?.kit ?? DEFAULT_KIT, look = me?.look ?? defaultLook(0);
  $('custom').classList.toggle('hidden', team === 'watch');
  $('customMech').classList.toggle('hidden', team !== 'mech');
  $('customTop').classList.toggle('hidden', team !== 'top');
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-pick]')) b.classList.toggle('selected', kit[b.parentElement!.dataset.slot as keyof MechKit] === b.dataset.pick);
  for (const el of document.querySelectorAll<HTMLElement>('[data-part]')) el.querySelector('b')!.textContent = DESIGN_NAMES[look[el.dataset.part as keyof TopLook]]!;
  $('kitHelp').textContent = KIT_HELP[lastPick] ?? '';
  if (team === 'mech') preview.show({ mech: kit });
  else if (team === 'top') preview.show({ top: look });
  scoreList($('scores'), lobby);

  if (lobby.phase === 'over') {
    $('finalTime').textContent = formatTime(lobby.lastTime);
    const mech = lobby.players.find(p => p.id === lobby.mech);
    $('finalRank').textContent = lobby.lastRank >= 0 ? `${mech?.name ?? 'The mech'} survived. That is #${lobby.lastRank + 1} on the board!` : lobby.players.some(p => p.bot) ? 'Practice run with bots: not recorded.' : `${mech?.name ?? 'The mech'} survived. Not a top-10 time.`;
    scoreList($('finalScores'), lobby, lobby.lastRank);
    $('again').classList.toggle('hidden', !hosting);
    status('overStatus', hosting ? '' : 'Waiting for the host.');
  }
}

// The simulation and input run from a worker timer: the browser pauses animation frames
// for a hidden or covered window, and the host must keep the round going for everyone.
const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000 / 60);'], { type: 'text/javascript' })));
let lastTick = performance.now();
ticker.onmessage = () => {
  const now = performance.now(), dt = Math.min(0.5, (now - lastTick) / 1000);
  lastTick = now;
  session?.update(dt, team => {
    const aim = controls.touch ? controls.touchAim(selfPosition(team)) : scene.pick(controls.pointer.x, controls.pointer.y);
    return team === 'mech' ? controls.mech(aim) : controls.top(aim);
  });
};

let latest: ArenaView | null = null;
/** Where your own character is, from the newest frame; touch aiming starts from there. */
function selfPosition(team: Team): { x: number; z: number } {
  const lobby = session?.lobby;
  if (!latest || !lobby) return { x: 0, z: 0 };
  const top = latest.tops[lobby.tops.indexOf(selfId)];
  return team === 'top' && top ? top : latest.mech;
}

/** Touch buttons: Dash for a top; the three kit abilities for the mech, each with its cooldown. */
function updateTouchButtons(view: ArenaView, team: Team): void {
  for (const b of document.querySelectorAll<HTMLElement>('[data-act]')) {
    const act = b.dataset.act!, show = act === 'dash' ? team === 'top' : team === 'mech';
    b.classList.toggle('hidden', !show);
    if (!show) continue;
    if (act === 'dash') {
      const t = view.tops[session?.lobby?.tops.indexOf(selfId) ?? -1];
      b.style.setProperty('--cd', String(t ? t.dashCd / view.dashCooldown : 0));
      continue;
    }
    const slot = act as 'move' | 'air' | 'guard', m = view.mech;
    b.textContent = KIT_NAMES[m.kit[slot]];
    b.classList.toggle('off', m.power[slot] <= 0);
    b.style.setProperty('--cd', String(m.cd[slot] / m.cdMax[slot]));
  }
}

let last = performance.now(), lastDraw = 0;
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const frame = session?.frame() ?? null;
  const lobby = session?.lobby;
  const selfTop = lobby ? lobby.tops.indexOf(selfId) : -1;
  const team: Team = lobby?.mech === selfId && lobby.phase !== 'lobby' ? 'mech' : selfTop >= 0 && lobby?.phase !== 'lobby' ? 'top' : 'watch';
  const live = !!lobby && lobby.phase !== 'lobby';
  // Behind the menus nothing moves, so draw only a few frames each second.
  const byId = new Map(lobby?.players.map(p => [p.id, p]) ?? []);
  const viewer = {
    team, top: selfTop,
    looks: lobby?.tops.map((id, i) => byId.get(id)?.look ?? defaultLook(i)) ?? [],
    names: lobby?.tops.map(id => byId.get(id)?.name ?? 'Top') ?? [],
    mechName: byId.get(lobby?.mech ?? '')?.name ?? 'Mech',
  };
  if (live || now - lastDraw > 100) { scene.render(live ? frame : null, viewer, live ? dt : (now - lastDraw) / 1000); lastDraw = now; }
  if (lobby?.phase === 'lobby' && !$('custom').classList.contains('hidden')) preview.render(dt);
  if (frame && lobby) { latest = frame.view; hud.update(frame.view, lobby, selfId); updateTouchButtons(frame.view, team); playEvents(frame.events); }
  requestAnimationFrame(loop);
}

void initPhysics().then(() => {
  show('home');
  requestAnimationFrame(loop);
  // Hook for automated browser tests.
  (window as unknown as { spinArena: unknown }).spinArena = { get session() { return session; }, room, scene };
});
