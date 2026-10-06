// Host + two guests through the public PeerJS broker. Needs `npm run dev` and internet access.
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://localhost:5211/';
const OUT = process.env.SHOT_DIR ?? 'e2e/out';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.spinArena, null, { timeout: 90000 });
  await page.fill('#name', name);
  return page;
}
let ok = true;
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); ok &&= !!cond; };
try {
  const host = await open('Dad');
  await host.click('#create');
  await host.waitForFunction(() => window.spinArena.room.status === 'open', null, { timeout: 20000 });
  const code = await host.evaluate(() => window.spinArena.room.code);
  check('host gets a room code', /^[A-Z2-9]{8}$/.test(code));
  const kids = [];
  for (const name of ['Ava', 'Ben']) {
    const kid = await open(name);
    await kid.fill('#code', code);
    await kid.click('#join');
    await kid.waitForFunction(() => window.spinArena.room.status === 'connected', null, { timeout: 20000 });
    kids.push(kid);
  }
  await host.waitForFunction(() => window.spinArena.session.lobby.players.length === 3);
  const teams = await host.evaluate(() => window.spinArena.session.lobby.players.map(p => `${p.name}:${p.team}`));
  check('guests join as tops, host is the mech', teams.join() === 'Dad:mech,Ava:top,Ben:top');
  // Anyone can change teams: Ava takes the mech after Dad switches to a top.
  await host.click('[data-team="top"]');
  await kids[0].click('[data-team="mech"]');
  await host.waitForFunction(() => window.spinArena.session.lobby.players.find(p => p.name === 'Ava')?.team === 'mech');
  await kids[1].waitForFunction(() => window.spinArena.session.lobby?.players.find(p => p.name === 'Ava')?.team === 'mech');
  check('team changes reach every player', true);
  // Loadouts: Ava picks the alternative mech kit; Ben changes his cap and tip.
  await kids[0].click('[data-slot="move"] [data-pick="blink"]');
  await kids[0].click('[data-slot="air"] [data-pick="hover"]');
  await kids[0].click('[data-slot="guard"] [data-pick="shield"]');
  await kids[1].click('[data-part="top"] [data-step="1"]');
  await kids[1].click('[data-part="bot"] [data-step="-1"]');
  await host.waitForFunction(() => { const p = window.spinArena.session.lobby.players; return p.find(x => x.name === 'Ava')?.kit.guard === 'shield' && p.find(x => x.name === 'Ben')?.look.bot !== p.find(x => x.name === 'Ben')?.look.mid; });
  const loadouts = await host.evaluate(() => window.spinArena.session.lobby.players.map(p => ({ name: p.name, kit: p.kit, look: p.look })));
  const ava = loadouts.find(p => p.name === 'Ava'), ben = loadouts.find(p => p.name === 'Ben');
  check('guest mech kit reaches the host', ava.kit.move === 'blink' && ava.kit.air === 'hover' && ava.kit.guard === 'shield');
  check('guest top parts reach the host', ben.look.top === (ben.look.mid + 1) % 4 && ben.look.bot === (ben.look.mid + 3) % 4);
  await kids[0].screenshot({ path: `${OUT}/lobby-mech.png` });
  await kids[1].screenshot({ path: `${OUT}/lobby-top.png` });
  check('Start is disabled until everyone is ready', await host.isDisabled('#start'));
  // The host renames itself in the lobby; the guests see it.
  await host.fill('#lobbyName', 'Papa');
  await host.press('#lobbyName', 'Enter');
  await kids[0].waitForFunction(() => window.spinArena.session.lobby?.players.some(p => p.name === 'Papa'), null, { timeout: 5000 });
  check('a name change in the lobby reaches the guests', true);
  // The host's map choice reaches the guests' scenes; then back to City Bowl for the tunnel checks below.
  await host.click('[data-map="yard"]');
  await kids[1].waitForFunction(() => window.spinArena.scene.mapId === 'yard', null, { timeout: 5000 });
  await host.click('[data-map="city"]');
  await kids[1].waitForFunction(() => window.spinArena.scene.mapId === 'city', null, { timeout: 5000 });
  check('the host map choice reaches the guests', true);
  for (const p of [host, ...kids]) await p.click('#ready');
  await host.waitForFunction(() => !document.querySelector('#start').disabled, null, { timeout: 5000 });
  check('Start is enabled when everyone is ready', true);
  await host.click('#start');
  await kids[1].waitForFunction(() => window.spinArena.session.lobby?.phase === 'playing');
  // Presses during the countdown do nothing, so wait for GO on the host (headless pages can run slowly).
  await host.waitForFunction(() => window.spinArena.session.arena?.clock > 0.3, null, { timeout: 30000 });
  const before = await host.evaluate(() => ({ ...window.spinArena.session.arena.mech }));
  // Ava (a guest) drives the mech to the right; Ben dashes.
  // One key action at a time: a focus change between pages clears held keys (as a real window blur would).
  await kids[1].keyboard.press('KeyQ');
  await kids[0].bringToFront();
  await kids[0].keyboard.down('KeyD');
  await host.waitForTimeout(1200);
  await kids[0].keyboard.up('KeyD');
  const after = await host.evaluate(() => ({ x: window.spinArena.session.arena.mech.x, dashes: window.spinArena.session.arena.tops.map(t => t.lastDash) }));
  check('guest input moves the mech on the host', after.x > before.x + 1);
  check('guest dash reaches the host', after.dashes.includes(1));
  await host.waitForTimeout(3000);
  const hostShadows = await host.evaluate(() => window.spinArena.session.arena.shadows.length);
  const guestFrame = await kids[1].evaluate(() => { const f = window.spinArena.session.frame(); return f ? { shadows: f.shadows.length / 3, mx: f.view.mech.x } : null; });
  console.log(JSON.stringify({ hostShadows, guestFrame, hostClock: await host.evaluate(() => window.spinArena.session.arena.clock) }));
  check('guest receives snapshots with the shadow', guestFrame && guestFrame.shadows === hostShadows && hostShadows >= 1);
  check('guest sees the mech where the host has it', guestFrame && Math.abs(guestFrame.mx - after.x) < 3);
  check('round uses the chosen mech kit', await host.evaluate(() => window.spinArena.session.arena.mech.kit.guard === 'shield'));
  // Hiding: put Ben's top in the middle of a tunnel. Ava (the mech) must not see his tag; Ben still sees his own.
  const benIndex = await host.evaluate(() => { const l = window.spinArena.session.lobby; return l.tops.indexOf(l.players.find(p => p.name === 'Ben').id); });
  const tags = page => page.evaluate(() => [...document.querySelectorAll('#tags .tag')].map(t => t.textContent));
  const placeBen = (x, z) => host.evaluate(([i, x, z]) => { const a = window.spinArena.session.arena, b = a.tops[i].body; b.setTranslation({ x, y: 1, z }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); }, [benIndex, x, z]);
  const mechAt = await host.evaluate(() => ({ x: window.spinArena.session.arena.mech.x, z: window.spinArena.session.arena.mech.z }));
  // Control: in the open, at about the same distance from the mech as the tunnel, Ava sees Ben.
  // Tags refresh when a page draws, and headless pages draw slowly, so wait for the expected state.
  const tagState = (page, name, shown) => page.waitForFunction(([n, v]) => [...document.querySelectorAll('#tags .tag')].some(t => t.textContent === n) === v, [name, shown], { timeout: 5000 }).then(() => true, () => false);
  await placeBen(mechAt.x - 5, mechAt.z + 4);
  check('a top in the open is visible to the mech', await tagState(kids[0], 'Ben', true));
  await placeBen(0, 10);
  const hiddenOk = await tagState(kids[0], 'Ben', false);
  const avaTags = await tags(kids[0]), benTags = await tags(kids[1]);
  const benPos = await host.evaluate(i => window.spinArena.session.arena.tops[i].body.translation(), benIndex);
  void benPos;
  check('a top under a tunnel is hidden from the mech', hiddenOk && !avaTags.includes('Ben') && avaTags.includes('Ava'));
  check('the hidden player still sees their own tag', benTags.includes('Ben'));
  // Headless pages draw only a few frames each second, so give the fade time.
  await kids[1].waitForFunction(() => { let o = 1; window.spinArena.scene.scene.traverse(n => { if (/^Tunnel[ _]Roof[ _]0$/.test(n.name)) n.traverse(c => { if (c.material) o = Math.min(o, c.material.opacity); }); }); return o < 0.5; }, null, { timeout: 5000 }).catch(() => {});
  const roofFaded = await kids[1].evaluate(() => { let o = 1; window.spinArena.scene.scene.traverse(n => { if (/^Tunnel[ _]Roof[ _]0$/.test(n.name)) n.traverse(c => { if (c.material) o = Math.min(o, c.material.opacity); }); }); return o; });
  check('the roof over your own top becomes see-through', roofFaded < 0.5);
  await kids[1].screenshot({ path: `${OUT}/guest.png` });
  await kids[0].screenshot({ path: `${OUT}/mech-view.png` });
  // Force the end and check that every player sees the result.
  await host.evaluate(() => { window.spinArena.session.arena.mech.status.health = 0; });
  await kids[0].waitForFunction(() => window.spinArena.session.lobby?.phase === 'over', null, { timeout: 5000 });
  const scores = await kids[0].evaluate(() => window.spinArena.session.lobby.scores.city);
  check('score is recorded and shared', scores.length >= 1 && scores[0].name === 'Ava');
  await host.click('#again');
  await kids[1].waitForFunction(() => window.spinArena.session.lobby?.phase === 'lobby');
  check('host returns everyone to the lobby', true);
  check('ready resets after a round', await host.evaluate(() => window.spinArena.session.lobby.players.every(p => !p.ready)));
} catch (e) { check(`no exception (${e.message.split('\n')[0]})`, false); }
check('no page errors', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(ok ? 0 : 1);
