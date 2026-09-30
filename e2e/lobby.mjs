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
  await page.goto(BASE);
  await page.waitForFunction(() => window.spinArena);
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
  await host.click('#start');
  await kids[1].waitForFunction(() => window.spinArena.session.lobby?.phase === 'playing');
  await host.waitForTimeout(3300);
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
  await kids[1].screenshot({ path: `${OUT}/guest.png` });
  // Force the end and check that every player sees the result.
  await host.evaluate(() => { window.spinArena.session.arena.mech.status.health = 0; });
  await kids[0].waitForFunction(() => window.spinArena.session.lobby?.phase === 'over', null, { timeout: 5000 });
  const scores = await kids[0].evaluate(() => window.spinArena.session.lobby.scores);
  check('score is recorded and shared', scores.length >= 1 && scores[0].name === 'Ava');
  await host.click('#again');
  await kids[1].waitForFunction(() => window.spinArena.session.lobby?.phase === 'lobby');
  check('host returns everyone to the lobby', true);
} catch (e) { check(`no exception (${e.message.split('\n')[0]})`, false); }
check('no page errors', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(ok ? 0 : 1);
