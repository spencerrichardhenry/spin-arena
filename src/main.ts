import { initPhysics } from './sim/arena.ts';
import { Scene } from './render/scene.ts';
import { Hud, scoreList, esc } from './render/hud.ts';
import { Controls } from './input.ts';
import { playEvents, unlockAudio } from './audio.ts';
import { Room } from './net/room.ts';
import { displayCode, normalizeCode, type Team } from './net/protocol.ts';
import { formatTime } from './sim/rules.ts';
import { GuestSession, HostSession, type Session } from './session.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const scene = new Scene(canvas);
const hud = new Hud();
const controls = new Controls(canvas);
const room = new Room();
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
$('botTop').onclick = () => (session as HostSession).addBot('top');
$('botMech').onclick = () => (session as HostSession).addBot('mech');
$('botClear').onclick = () => (session as HostSession).removeBots();
$('start').onclick = () => { unlockAudio(); (session as HostSession).start(); };
$('again').onclick = () => (session as HostSession).backToLobby();
$('leave').onclick = () => { room.stop(); session = null; show('home'); status('homeStatus', ''); };

const HELP: Record<Team, string> = {
  mech: '<h3>Mech controls</h3><p><kbd>WASD</kbd> move · mouse to face</p><p><kbd>Shift</kbd> boost · <kbd>Space</kbd> jump to the mouse</p><p><kbd>Right click</kbd> or <kbd>E</kbd> parry pulse</p><p>Each side has 3 plates. 3 hits break a side and its power. 12 hits end the run. Shadows only slow and push you.</p>',
  top: '<h3>Top controls</h3><p><kbd>WASD</kbd> move · <kbd>Q</kbd> or <kbd>click</kbd> dash toward the mouse</p><p>3 seconds after each dash, a shadow top replays it. Shadows never stop.</p><p>Hit the mech hard. Aim for a damaged side.</p>',
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
  const aim = scene.pick(controls.pointer.x, controls.pointer.y);
  session?.update(dt, team => (team === 'mech' ? controls.mech(aim) : controls.top(aim)));
};

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
  if (live || now - lastDraw > 100) { scene.render(live ? frame : null, { team, top: selfTop }, live ? dt : (now - lastDraw) / 1000); lastDraw = now; }
  if (frame && lobby) { hud.update(frame.view, lobby, selfId); playEvents(frame.events); }
  requestAnimationFrame(loop);
}

void initPhysics().then(() => {
  show('home');
  requestAnimationFrame(loop);
  // Hook for automated browser tests.
  (window as unknown as { spinArena: unknown }).spinArena = { get session() { return session; }, room, scene };
});
