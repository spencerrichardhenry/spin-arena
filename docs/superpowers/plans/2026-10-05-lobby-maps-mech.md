# Ready Lobby, New Maps and Stronger Mech — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the start-of-round ability bug, make the mech's arms abilities stronger, add Ready and nickname editing to the lobby, and add three new maps (Conveyor Yard, Sawmill, Bumper Park) that the host picks in the lobby.

**Architecture:** The simulation (`src/sim`) stays engine-only and deterministic. Maps become data in a new `src/sim/maps.ts`; `src/sim/city.ts` exposes the active map's obstacles as ES module live bindings (`export let`) that `setMap(id)` rebuilds, and `src/sim/bowl.ts` gets a floor switch (oval bowl or flat convex polygon) with `surfaceHeight`, `clampInside`, `clampMech` and `onFloor`. Hazards (belts, saws, bumpers) are applied by `Arena` around the Rapier step. The lobby carries `map`, per-player `ready`, and per-map best times.

**Tech Stack:** TypeScript 7, Vite 8, three.js 0.185, Rapier 3D compat 0.12, PeerJS, Vitest 4, Playwright.

**Spec:** `docs/specs/2026-10-05-lobby-maps-mech-design.md`

## Global Constraints

- `PROTOCOL` = 2 (`src/net/protocol.ts`).
- All tuning numbers live in `src/tuning.ts`. New values: `MECH.parryStun` 3.5, `MECH.shieldTime` 5, `MECH.lockCooldown` 10; `FALL.outY` −6, `FALL.respawnTime` 3; `HAZARD.beltTopSpeed` 18, `HAZARD.beltAccel` 30, `HAZARD.beltMechSpeed` 5, `HAZARD.sawRadius` 1.6, `HAZARD.sawThrow` 30, `HAZARD.bumperRadius` 1.4, `HAZARD.bumperKick` 24.
- Map ids and names: `city` City Bowl, `yard` Conveyor Yard, `sawmill` Sawmill, `bumpers` Bumper Park.
- The mech never falls. Shadows never fall and are never affected by belts or saws.
- `tsconfig.json` has `strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, and includes `tests/`. `npm run build` (`tsc -b && vite build`) must pass after every task.
- Code style: match the existing files — dense one-line helpers, JSDoc one-liners on non-obvious members, no new dependencies.
- User-facing text follows the existing lobby voice (short plain sentences).

## Review Focus

1. A guest that joins (or is already in the lobby) when the host changes the map must render and pick on the new map — covered by a check in Task 7's e2e step.
2. A top that falls while locked, stunned or empowered must come back clean (no stale lock/stun/empower) — covered in Task 4's Sawmill fall test.
3. Lock and parry must not affect a top that is out (fallen) — covered in Task 4's Sawmill fall test.
4. Switching maps quickly must leave only the newest map's meshes in the scene — covered by the build counter in Task 8 and the practice e2e map loop in Task 9.
5. Counters from an earlier round, and presses during the countdown, must not fire at GO — for tops and the mech — covered in Task 1.

---

### Task 1: Presses before GO do not fire abilities

**Files:**
- Modify: `src/sim/arena.ts` (`step`, new `holdPresses`)
- Test: `tests/arena.test.ts`

**Interfaces:**
- Produces: `Arena.step` ignores press counter changes while `clock < 0`, and stores the counters.

- [ ] **Step 1: Write the failing test** — add at the end of `tests/arena.test.ts`:

```ts
describe('round start', () => {
  it('ignores presses from an earlier round and from the countdown', () => {
    const a = new Arena(1, 1, { move: 'boost', air: 'cloak', guard: 'shield' });
    // Counters carried over from the round before.
    const old: MechInput = { ...REST_MECH, boost: 4, jump: 3, parry: 2 };
    run(a, 0.5, [{ ...REST_TOP, dash: 5 }], old);
    // One more press of each during the countdown, held through GO.
    const early: MechInput = { ...old, boost: 5, jump: 4, parry: 3 };
    run(a, 0.7, [{ ...REST_TOP, dash: 6 }], early);
    expect(a.clock).toBeGreaterThan(0);
    const kinds = a.drainEvents().map(e => e.k);
    for (const k of ['boost', 'cloak', 'shield', 'dash']) expect(kinds).not.toContain(k);
    expect(a.view().mech.cd).toEqual({ move: 0, air: 0, guard: 0 });
    expect(a.view().tops[0]!.dashCd).toBe(0);
    // A press after GO still works.
    run(a, 1 / 60, [{ ...REST_TOP, dash: 7 }], { ...early, boost: 6 });
    expect(a.drainEvents().map(e => e.k)).toEqual(expect.arrayContaining(['boost', 'dash']));
    a.dispose();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/arena.test.ts -t "round start"`
Expected: FAIL — `kinds` contains `boost`.

- [ ] **Step 3: Implement** — in `src/sim/arena.ts`, change the start of `step`:

```ts
  step(tops: readonly TopInput[], mech: MechInput): void {
    if (this.over) return;
    this.clock += DT;
    if (this.clock < 0) { this.holdPresses(tops, mech); return; }
```

and add after `step`:

```ts
  /**
   * During the countdown, presses only update the counters. Controls count presses for the whole session,
   * so without this every counter that is not 0 would look like a new press at GO.
   */
  private holdPresses(tops: readonly TopInput[], mech: MechInput): void {
    this.tops.forEach((t, i) => { const input = tops[i]; if (input) t.lastDash = input.dash; });
    this.mech.last = { boost: mech.boost, jump: mech.jump, parry: mech.parry };
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run`
Expected: all PASS (existing tests use countdown 0, so they press on the first step as before).

- [ ] **Step 5: Commit**

```bash
git add src/sim/arena.ts tests/arena.test.ts
git commit -m "Fix: presses before GO no longer fire every ability at the start"
```

---

### Task 2: Stronger mech arms — parry stun, 360° shield, global lock

**Files:**
- Modify: `src/tuning.ts` (MECH), `src/sim/arena.ts`, `src/render/scene.ts`, `src/render/hud.ts`, `src/main.ts` (KIT_HELP), `README.md`
- Test: `tests/arena.test.ts`, `tests/protocol.test.ts` (TopView literal)

**Interfaces:**
- Produces: `TopView.stunned: boolean`; `MECH.parryStun`; `Arena.fling(top, now, speed, stun = 0)` (private).
- Removes: `MECH.shieldArc`, `MECH.lockRange`, `MECH.lockArc`.

- [ ] **Step 1: Write the failing tests** — in `tests/arena.test.ts`:

Replace the test `'shield blocks a hit on the front and deletes shadows there, but not on the rear'` with:

```ts
  it('shield blocks hits from every side and deletes every shadow that touches it', () => {
    const a = new Arena(1, 0, kit({ guard: 'shield' }));
    run(a, 1 / 60, [], { ...REST_MECH, ax: 0, az: -10, parry: 1 }); // mech faces −Z (yaw π)
    const top = a.tops[0]!;
    top.body.setTranslation({ x: 0, y: surfaceHeight(0, 5) + TOP.radius, z: 5 }, true); // behind the mech
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    let blocked = false;
    for (let i = 0; i < 40 && !blocked; i++) { a.step([{ ...REST_TOP, mz: -1, dash: 1 }], { ...REST_MECH, ax: 0, az: -10, parry: 1 }); blocked = a.drainEvents().some(e => e.k === 'block'); }
    expect(blocked).toBe(true);
    expect(a.mech.status.health).toBe(MECH.health);
    a.addShadow(0, 0, 4, 0, -1); // from behind
    run(a, 0.3, [], { ...REST_MECH, ax: 0, az: -10, parry: 1 });
    expect(a.shadows).toHaveLength(0);
    expect(a.mech.status.slows).toHaveLength(0);
    expect(MECH.shieldTime).toBe(5);
    a.dispose();
  });
```

Replace the two lock tests (`'lock freezes the nearest top in front, …'` and `'lock with no top in front does nothing and keeps its cooldown'`) with:

```ts
  it('lock freezes every top on the map, far away and behind the mech too', () => {
    const a = new Arena(2, 0, kit({ guard: 'lock' }));
    const [near, far] = a.tops;
    near!.body.setTranslation({ x: 0, y: bowlHeight(5) + TOP.radius, z: -5 }, true); // in front (mech faces −Z)
    far!.body.setTranslation({ x: -25, y: surfaceHeight(-25, 14) + TOP.radius, z: 14 }, true); // far behind
    for (const t of [near!, far!]) t.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    run(a, 1 / 60, [], { ...REST_MECH, parry: 1 });
    expect(a.view().tops.map(t => t.locked)).toEqual([true, true]);
    const p0 = { ...near!.body.translation() };
    run(a, 1, [{ ...REST_TOP, mx: 1, dash: 1 }], { ...REST_MECH, parry: 1 });
    const p1 = near!.body.translation();
    expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeLessThan(0.2);
    expect(a.shadows.length + (a as unknown as { pending: unknown[] }).pending.length).toBe(0); // no ability while locked
    run(a, MECH.lockTime, [{ ...REST_TOP, mx: 1, dash: 1 }], { ...REST_MECH, parry: 1 });
    expect(a.view().tops[0]!.locked).toBe(false);
    a.dispose();
  });
  it('lock starts its cooldown even with no tops', () => {
    const a = new Arena(0, 0, kit({ guard: 'lock' }));
    run(a, 1 / 60, [], { ...REST_MECH, parry: 1 });
    expect(a.view().mech.cd.guard).toBeCloseTo(MECH.lockCooldown, 1);
    expect(MECH.lockCooldown).toBe(10);
    a.dispose();
  });
  it('parry stuns the tops it throws: no steering and no ability until the stun ends', () => {
    // Same throw twice, once with steering: the stunned top must end up in the same place.
    const play = (mx: number) => {
      const a = new Arena(1, 0);
      const top = a.tops[0]!;
      top.body.setTranslation({ x: 0, y: bowlHeight(4) + TOP.radius, z: 4 }, true);
      top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      run(a, 1 / 60, [], { ...REST_MECH, parry: 1 });
      expect(a.view().tops[0]!.stunned).toBe(true);
      run(a, 1.5, [{ ...REST_TOP, mx, dash: 1 }], { ...REST_MECH, parry: 1 });
      const p = { ...top.body.translation() }, v = a.view().tops[0]!;
      a.dispose();
      return { p, v };
    };
    const still = play(0), steered = play(1);
    expect(steered.p.x).toBeCloseTo(still.p.x, 3);
    expect(steered.p.z).toBeCloseTo(still.p.z, 3);
    expect(steered.v.dashCd).toBe(0); // the press during the stun did nothing
    expect(steered.v.stunned).toBe(true);
    const a = new Arena(1, 0);
    a.tops[0]!.body.setTranslation({ x: 0, y: bowlHeight(4) + TOP.radius, z: 4 }, true);
    run(a, 1 / 60, [], { ...REST_MECH, parry: 1 });
    run(a, MECH.parryStun, [], { ...REST_MECH, parry: 1 });
    expect(a.view().tops[0]!.stunned).toBe(false);
    run(a, 1 / 60, [{ ...REST_TOP, dash: 1 }], { ...REST_MECH, parry: 1 });
    expect(a.view().tops[0]!.dashCd).toBeGreaterThan(0); // works again
    a.dispose();
  });
```

In `tests/protocol.test.ts`, test `'interpolates positions and turns the short way'`, add `stunned: false` to the top literal: `…, empowered: false, locked: false, stunned: false }]`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/arena.test.ts -t "shield|lock|parry stuns"`
Expected: FAIL (shield from behind not blocked; far top not locked; `stunned` undefined).

- [ ] **Step 3: Implement**

`src/tuning.ts` — in `MECH`, replace the parry/shield/lock lines:

```ts
  parryTopSpeed: 44,
  /** After a parry, a top ignores its own movement input for this long, so it flies across the arena. */
  parryFlingTime: 0.7,
  /** A parried top is stunned for this long: no steering and no ability. */
  parryStun: 3.5,
```
```ts
  /** Shield (arms): armour all around the mech; blocks tops and deletes shadows. Time falls with front hits. */
  shieldTime: 5,
  shieldCooldown: 9,
  shieldBounce: 22,
```
```ts
  /** Lock (arms): freezes every top on the map. */
  lockTime: 2.5,
  lockCooldown: 10,
```
(delete `shieldArc`, `lockRange`, `lockArc`).

`src/sim/arena.ts`:
- Remove `forward` from the `./rules.ts` import.
- `interface Top`: add `stunnedUntil: number;` after `lockedUntil`. In `addTop`, add `stunnedUntil: -1`.
- `TopView`: `empowered: boolean; locked: boolean; stunned: boolean;`. In `view()`: `…, locked: now < t.lockedUntil, stunned: now < t.stunnedUntil,`.
- `stepTops`:

```ts
      if (input.dash !== top.lastDash) {
        top.lastDash = input.dash;
        if (now >= top.dashReadyAt && now >= top.lockedUntil && now >= top.stunnedUntil) this.useAbility(top, i, input, now);
      }
      if (now < top.lockedUntil) { top.body.setLinvel({ x: 0, y: Math.min(0, v.y), z: 0 }, true); return; }
      if (now < top.dashUntil) {
        top.body.setLinvel({ x: top.dirX * TOP.dashSpeed, y: v.y, z: top.dirZ * TOP.dashSpeed }, true);
        return;
      }
      if (now < top.flungUntil || now < top.stunnedUntil) return;
```

- `useGuard`, lock branch:

```ts
    if (m.kit.guard === 'lock') {
      const time = lockTime(s);
      if (time <= 0) return;
      // Lock reaches every top on the map, at any distance and in any direction.
      this.tops.forEach((t, i) => {
        t.lockedUntil = now + time; t.dashUntil = -1; t.flungUntil = -1;
        this.events.push({ k: 'lock', top: i });
      });
      m.guardUntil = now + 0.2; m.guardReadyAt = now + MECH.lockCooldown;
      return;
    }
```

- `pulse`: `if (hyp(p.x - m.x, p.z - m.z) <= reach) this.fling(top, now, MECH.parryTopSpeed, MECH.parryStun);`
- `fling`:

```ts
  private fling(top: Top, now: number, speed: number, stun = 0): void {
    const m = this.mech, p = top.body.translation();
    const dx = p.x - m.x, dz = p.z - m.z, d = hyp(dx, dz);
    const nx = d > 0.01 ? dx / d : 0, nz = d > 0.01 ? dz / d : 1;
    top.dashUntil = -1;
    top.flungUntil = now + MECH.parryFlingTime;
    if (stun > 0) top.stunnedUntil = Math.max(top.stunnedUntil, now + stun);
    top.body.setLinvel({ x: nx * speed, y: 4, z: nz * speed }, true);
  }
```

- Replace `shielded`:

```ts
  /** True while the shield is up. It covers the mech all around. */
  private shielded(now: number): boolean { return this.mech.kit.guard === 'shield' && now < this.mech.guardUntil; }
```

- `resolveHits`: parry line becomes `if (parrying) { if (now >= top.flungUntil) this.fling(top, now, MECH.parryTopSpeed, MECH.parryStun); return; }`; shield check becomes `if (this.shielded(now)) {`; the shadow line becomes:

```ts
    // During the parry or the shield, a shadow that touches the mech is deleted.
    if (parrying || this.shielded(now)) { this.removeShadows(touching); return; }
```
(delete the old `this.removeShadows(sh => … this.shielded(…))` line).

`src/render/scene.ts`:
- Shield mesh, full cylinder: `this.shieldArc = new THREE.Mesh(new THREE.CylinderGeometry(MECH.radius + 0.5, MECH.radius + 0.5, 2.6, 24, 1, true), …)` (delete the `arc` const).
- `effect`, shield case: `case 'shield': this.ring(m.x, m.z, MECH.radius + 0.5, 0x7fe3ff, 0.3, 1); break;` and remove `forward` from the rules import.
- Stun stars: add field `private stars: THREE.Mesh[] = [];` and at the end of `updateStates` (before `void viewer;`):

```ts
    const stunned = view.tops.filter((top, i) => top.stunned && this.tops[i]?.visible !== false);
    pool(this.stars, stunned.length, () => new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffe14f })));
    stunned.forEach((top, i) => { const mesh = this.stars[i]!; mesh.position.set(top.x, top.y + 1.2, top.z); mesh.rotation.set(Math.PI / 2, 0, t * 6); });
```

`src/render/hud.ts` top row: `${t.locked ? ' ❄' : ''}${t.stunned ? ' 💫' : ''}`.

`src/main.ts` `KIT_HELP`:

```ts
  parry: 'Parry: a pulse that deletes shadows, throws tops away and stuns them for 3.5 s.',
  shield: 'Shield: 5 s of armour all around you. It deletes every shadow that touches it.',
  lock: 'Lock: freeze every top on the map for 2.5 s.',
```

`README.md` controls table, mech E row: `Arms: **Parry** (deletes shadows, throws tops and stuns them for 3.5 s), **Shield** (5 s of armour all around) or **Lock** (freeze every top on the map for 2.5 s)`.

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run && npx tsc -b`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src tests README.md
git commit -m "Mech arms: parry stuns 3.5 s, shield all around for 5 s, lock freezes every top"
```

---

### Task 3: Lobby — Ready for every player, and nicknames

**Files:**
- Modify: `src/net/protocol.ts`, `src/session.ts`, `src/main.ts`, `index.html`, `src/style.css`
- Create: `tests/session.test.ts`
- Test: `tests/protocol.test.ts`

**Interfaces:**
- Produces (protocol): `LobbyPlayer.ready: boolean`; guest messages `{ t: 'ready'; ready: boolean }`, `{ t: 'name'; name: string }`; `teamsOk(players): boolean`; `isReady(players, p): boolean`; `notReady(players): LobbyPlayer[]`; `canStart` = `teamsOk && notReady().length === 0`; `chooseTeam` resets `ready`.
- Produces (session): `Session.setReady(ready: boolean)`, `Session.setName(name: string)`; `HostSession` resets `ready` in `backToLobby`.

- [ ] **Step 1: Write the failing tests**

`tests/protocol.test.ts`: import `notReady` and `type Team` too; in `'allows one mech and up to four tops'`, add `ready: true` to the player literal. Add:

```ts
  it('starts only when every player is ready; a team change resets ready', () => {
    const p = (id: string, team: Team, extra: Partial<LobbyPlayer> = {}): LobbyPlayer =>
      ({ id, name: id, team, connected: true, host: false, ready: false, kit: DEFAULT_KIT, look: defaultLook(0), ...extra });
    const players = [p('host', 'mech'), p('kid', 'top'), p('kid~2', 'top'), p('bot-1', 'top', { bot: true }), p('dad', 'watch')];
    expect(canStart(players)).toBe(false);
    expect(notReady(players).map(x => x.id)).toEqual(['host', 'kid', 'kid~2', 'dad']);
    players[1]!.ready = true; // the second keyboard player follows its owner
    expect(notReady(players).map(x => x.id)).toEqual(['host', 'dad']);
    players[0]!.ready = true; players[4]!.ready = true;
    expect(canStart(players)).toBe(true);
    expect(chooseTeam(players, 'dad', 'top', 4)).toBe(true);
    expect(players[4]!.ready).toBe(false);
    expect(canStart(players)).toBe(false);
  });
```

Create `tests/session.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, REST_MECH } from '../src/sim/arena.ts';
import { HostSession } from '../src/session.ts';
import type { GuestMessage } from '../src/net/protocol.ts';
import type { Room } from '../src/net/room.ts';

beforeAll(async () => { await initPhysics(); });

/** A room that only records what the host broadcasts. */
function fakeRoom() {
  const room = {
    sent: [] as unknown[],
    onGuestJoin: (_id: string, _name: string) => {}, onGuestLeave: (_id: string) => {}, onGuestMessage: (_id: string, _m: GuestMessage) => {},
    broadcast(msg: unknown) { this.sent.push(msg); },
  };
  return room;
}

describe('host lobby', () => {
  it('applies ready and name messages, starts when all are ready, and resets ready after the round', () => {
    const room = fakeRoom();
    const host = new HostSession('h', 'Dad', room as unknown as Room);
    room.onGuestJoin('g', 'Ava');
    const ava = () => host.lobby.players.find(p => p.id === 'g')!;
    expect(ava().team).toBe('top');
    expect(host.canStart).toBe(false);
    room.onGuestMessage('g', { t: 'name', name: '<b>Bo</b>' });
    expect(ava().name).toBe('bBob');
    room.onGuestMessage('g', { t: 'ready', ready: true });
    expect(host.canStart).toBe(false); // the host is not ready yet
    host.setReady(true);
    expect(host.canStart).toBe(true);
    host.setName('Papa');
    expect(host.lobby.players[0]!.name).toBe('Papa');
    host.start(0);
    expect(host.lobby.phase).toBe('playing');
    host.backToLobby();
    expect(host.lobby.players.every(p => !p.ready)).toBe(true);
  });
  it('ignores a ready message that is not a boolean', () => {
    const room = fakeRoom();
    const host = new HostSession('h', 'Dad', room as unknown as Room);
    room.onGuestJoin('g', 'Ava');
    room.onGuestMessage('g', { t: 'ready', ready: 'yes' } as unknown as GuestMessage);
    expect(host.lobby.players.find(p => p.id === 'g')!.ready).toBe(false);
    void REST_MECH;
  });
});
```

(Note: `cleanName('<b>Bo</b>')` removes `<`, `>`, `/`, giving `bBob`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/protocol.test.ts tests/session.test.ts`
Expected: FAIL (`notReady` missing; `setReady` missing).

- [ ] **Step 3: Implement**

`src/net/protocol.ts`:

```ts
export const PROTOCOL = 2;
```
```ts
export interface LobbyPlayer { id: string; name: string; team: Team; connected: boolean; host: boolean; ready: boolean; bot?: boolean; kit: MechKit; look: TopLook }
```
```ts
export type GuestMessage =
  | { t: 'hello'; version: number; id: string; name: string }
  | { t: 'team'; team: Team }
  | { t: 'ready'; ready: boolean }
  | { t: 'name'; name: string }
  | { t: 'kit'; kit: MechKit }
  | { t: 'look'; look: TopLook }
  | { t: 'input'; input: AnyInput }
  | { t: 'ping' };
```
In `chooseTeam`, replace `p.team = team;` with `p.team = team; p.ready = false;`. Replace `canStart` with:

```ts
/** One mech and one to four tops. */
export function teamsOk(players: readonly LobbyPlayer[]): boolean {
  const mech = players.filter(p => p.team === 'mech').length, tops = players.filter(p => p.team === 'top').length;
  return mech === 1 && tops >= 1;
}
/** Bots are always ready; a second keyboard player (id `<owner>~2`) is ready when its owner is. */
export function isReady(players: readonly LobbyPlayer[], p: LobbyPlayer): boolean {
  if (p.bot || p.ready) return true;
  return p.id.endsWith('~2') && !!players.find(o => o.id === p.id.slice(0, -2))?.ready;
}
export function notReady(players: readonly LobbyPlayer[]): LobbyPlayer[] { return players.filter(p => p.connected && !isReady(players, p)); }
export function canStart(players: readonly LobbyPlayer[]): boolean { return teamsOk(players) && notReady(players).length === 0; }
```

`src/session.ts`:
- `Session` interface: add `setReady(ready: boolean): void;` and `setName(name: string): void;`.
- Every `LobbyPlayer` literal gets `ready`: the host's own player and new guests and `setSecond` use `ready: false`; `addBot` uses `ready: true`.
- `guestMessage`:

```ts
    else if (msg.t === 'ready') { if (typeof msg.ready === 'boolean') this.setPlayer(id, { ready: msg.ready }); }
    else if (msg.t === 'name') this.setPlayer(id, { name: msg.name });
    else if (msg.t === 'kit') { const kit = readKit(msg.kit); if (kit) this.setPlayer(id, { kit }); }
    else if (msg.t === 'look') { const look = readLook(msg.look); if (look) this.setPlayer(id, { look }); }
```
- Replace `setLoadout` with `setPlayer` (and update `setKit`/`setLook` to call it):

```ts
  setKit(kit: MechKit): void { this.setPlayer(this.selfId, { kit }); }
  setLook(look: TopLook): void { this.setPlayer(this.selfId, { look }); }
  setReady(ready: boolean): void { this.setPlayer(this.selfId, { ready }); }
  setName(name: string): void {
    this.setPlayer(this.selfId, { name });
    if (this.secondId) this.setPlayer(this.secondId, { name: `${cleanName(name)} 2` });
  }
  private setPlayer(id: string, change: { kit?: MechKit; look?: TopLook; ready?: boolean; name?: unknown }): void {
    const p = this.lobby.players.find(x => x.id === id);
    if (!p || this.lobby.phase !== 'lobby') return;
    if (change.kit) p.kit = { ...change.kit };
    if (change.look) p.look = { ...change.look };
    if (change.ready !== undefined) p.ready = change.ready;
    if (change.name !== undefined) p.name = cleanName(change.name);
    this.changed();
  }
```
- `backToLobby`: after the `players` filter, add `for (const p of this.lobby.players) p.ready = false;`.
- `GuestSession`: `setReady(ready: boolean): void { this.room.toHost({ t: 'ready', ready }); }` and `setName(name: string): void { this.room.toHost({ t: 'name', name }); }`.

`index.html` lobby section — after `<h2 id="lobbyTitle">Lobby</h2>` add:

```html
    <label id="nameRow" class="row nameRow">Your name <input id="lobbyName" maxlength="16" autocomplete="off" /></label>
```
and before `<button id="start" class="primary">Start</button>` add:

```html
    <button id="ready">Ready</button>
```

`src/style.css` — after the `#players .off` rule:

```css
#players .ready { color: #7be0a0; font-size: 12px; }
#players .waiting { color: #8d97ad; font-size: 12px; }
.nameRow { align-items: center; gap: 8px; }
.nameRow input { flex: 1; }
#ready.selected { background: #1f5a3a; border-color: #7be0a0; }
```
In the `@media (max-height: 560px)` block, change the template areas and add the two areas:

```css
    grid-template-areas: 'title custom' 'invite custom' 'name custom' 'players custom' 'teams custom' 'tools columns' 'ready columns' 'start columns' 'status leave';
```
```css
  #nameRow { grid-area: name; }
  #ready { grid-area: ready; }
```

`src/main.ts`:
- Import `isReady, notReady, teamsOk` from `./net/protocol.ts`.
- After the `myName` line:

```ts
const lobbyName = $<HTMLInputElement>('lobbyName');
/** A name change in the lobby: saved like the home screen name, and sent for this player and a second keyboard player. */
function rename(): void {
  if (!lobbyName.value.trim()) return;
  nameInput.value = lobbyName.value;
  const name = myName();
  session?.setName(name);
  secondGuest?.session.setName(`${name} 2`);
}
lobbyName.addEventListener('change', rename);
lobbyName.addEventListener('keydown', e => { if (e.key === 'Enter') lobbyName.blur(); });
```
- After the `$('start').onclick` line: `$('ready').onclick = () => { const me = session?.lobby?.players.find(p => p.id === selfId); session?.setReady(!me?.ready); };`
- In `renderLobby`, after `const me = …`:

```ts
  if (document.activeElement !== lobbyName) lobbyName.value = me?.name ?? '';
  $('ready').textContent = me?.ready ? 'Ready ✓' : 'Ready';
  $('ready').classList.toggle('selected', !!me?.ready);
  const waiting = notReady(lobby.players);
```
- Player list item: before `<span class="team …">` insert `${isReady(lobby.players, p) ? '<span class="ready">ready</span>' : '<span class="waiting">not ready</span>'}`.
- Replace the status lines:

```ts
  const waitText = `Waiting for: ${waiting.map(p => p.name).join(', ')}.`;
  if (hosting && !host?.canStart) status('lobbyStatus', teamsOk(lobby.players) ? waitText : 'To start, you need one mech and one to four tops.');
  else if (!hosting) status('lobbyStatus', online ? (waiting.length ? waitText : 'Waiting for the host to start.') : room.message, room.status === 'error');
  else if (online || !room.code) status('lobbyStatus', room.code ? 'Everyone is ready. Start now.' : 'Ready.');
```
- `HELP.watch`: `'<h3>Watching</h3><p>Pick a team to play in the next round. Click Ready so the host can start.</p>'`.

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run && npx tsc -b`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests index.html
git commit -m "Lobby: Ready button for every player, Start waits for all; edit your name in the lobby"
```

---

### Task 4: Map model, flat floors, the three new layouts, and falling off Sawmill

**Files:**
- Create: `src/sim/maps.ts`
- Modify: `src/sim/bowl.ts`, `src/sim/city.ts`, `src/sim/arena.ts`, `src/tuning.ts`
- Test: `tests/maps.test.ts` (new)

**Interfaces:**
- Produces (`bowl.ts`): `type Floor = { kind: 'bowl' } | { kind: 'flat'; outline: [number, number][]; open: boolean }`; `setFloor(f)`, `activeFloor(): Floor`, `surfaceHeight(x, z)` (now map-aware), `clampInside(x, z, inset)`, `clampMech(x, z)`, `onFloor(x, z): boolean`.
- Produces (`maps.ts`): `type MapId = 'city' | 'yard' | 'sawmill' | 'bumpers'`; `MAP_IDS`; `readMapId(v): MapId | null`; `interface Belt { x; z; length; width; angle }`; `interface Saw { from: [number, number]; to: [number, number]; period: number }`; `interface MapDef { id; name; blurb; floor; layout; mechStart; belts; saws; bumpers }`; `MAPS: Record<MapId, MapDef>`.
- Produces (`city.ts`): `setMap(id: MapId)`; live `MAP`, `WALLS`, `BUILDINGS`, `SPAWNS`, `TREES`, `TUNNELS`, `TUNNEL_BOXES`, `RIM` (closed flat maps: one box per edge).
- Produces (`arena.ts`): `new Arena(topCount, countdown, kit, abilities, map: MapId = 'city')`; `TopView.out: boolean`; events `{ k: 'fall'; top }`, `{ k: 'respawn'; top }`; `FALL` in tuning.

- [ ] **Step 1: Write the failing tests** — create `tests/maps.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { Arena, initPhysics, REST_MECH, REST_TOP, type MechInput, type TopInput } from '../src/sim/arena.ts';
import { clampInside, onFloor } from '../src/sim/bowl.ts';
import { BUILDINGS, MAP, pushOutOfBox, pushOutOfTree, setMap, SPAWNS, TREES, TUNNEL_BOXES, WALLS } from '../src/sim/city.ts';
import { MAP_IDS, MAPS, readMapId } from '../src/sim/maps.ts';
import { FALL, MECH, TOP } from '../src/tuning.ts';

beforeAll(async () => { await initPhysics(); });

function run(arena: Arena, seconds: number, tops: TopInput[] = [], mech: MechInput = REST_MECH): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) arena.step(tops, mech);
}

describe('maps', () => {
  it('has four maps with names', () => {
    expect(MAP_IDS).toEqual(['city', 'yard', 'sawmill', 'bumpers']);
    expect(MAP_IDS.map(id => MAPS[id].name)).toEqual(['City Bowl', 'Conveyor Yard', 'Sawmill', 'Bumper Park']);
    expect(readMapId('yard')).toBe('yard');
    expect(readMapId('moon')).toBeNull();
  });
  for (const id of MAP_IDS) it(`${id}: spawn points and the mech start are on the floor and clear`, () => {
    setMap(id);
    const blocked = (x: number, z: number, r: number) =>
      [...BUILDINGS, ...WALLS, ...TUNNEL_BOXES].some(b => pushOutOfBox(b, x, z, r)) || TREES.some(t => pushOutOfTree(t, x, z, r));
    for (const [x, z] of SPAWNS) {
      expect(onFloor(x, z)).toBe(true);
      expect(clampInside(x, z, TOP.radius)).toBeNull();
      expect(blocked(x, z, TOP.radius + 0.5)).toBe(false);
    }
    const [mx, mz] = MAP.mechStart;
    expect(blocked(mx, mz, MECH.radius)).toBe(false);
    expect(SPAWNS.length).toBeGreaterThanOrEqual(4);
  });
  it('a rim map keeps a fast top inside', () => {
    const a = new Arena(1, 0, undefined, [], 'yard');
    const top = a.tops[0]!;
    top.body.setTranslation({ x: 25, y: TOP.radius + 0.02, z: -16 }, true);
    top.body.setLinvel({ x: 30, y: 0, z: 0 }, true);
    run(a, 1, [REST_TOP]);
    const p = top.body.translation();
    expect(p.x).toBeLessThan(30);
    expect(p.y).toBeGreaterThan(-0.5);
    a.dispose();
  });
  it('Sawmill: a top that rolls off falls, is out for 3 s, ignores presses, and respawns clean at a spawn', () => {
    const a = new Arena(1, 0, { move: 'boost', air: 'jump', guard: 'lock' }, [], 'sawmill');
    const top = a.tops[0]!;
    top.body.setTranslation({ x: 20, y: TOP.radius + 0.02, z: -15 }, true); // by the open east edge, clear of the rail
    top.body.setLinvel({ x: 15, y: 0, z: 0 }, true);
    let fell = false;
    for (let i = 0; i < 120 && !fell; i++) { a.step([REST_TOP], REST_MECH); fell = a.drainEvents().some(e => e.k === 'fall'); }
    expect(fell).toBe(true);
    expect(a.view().tops[0]!.out).toBe(true);
    // Presses while out do nothing; the mech's lock does not reach it.
    run(a, 1, [{ ...REST_TOP, dash: 1 }], { ...REST_MECH, parry: 1 });
    expect(a.view().tops[0]!.dashCd).toBe(0);
    expect(a.view().tops[0]!.locked).toBe(false);
    run(a, FALL.respawnTime, [{ ...REST_TOP, dash: 1 }], { ...REST_MECH, parry: 1 });
    const v = a.view().tops[0]!;
    expect(v.out).toBe(false);
    expect(v.locked).toBe(false);
    expect(SPAWNS.some(([x, z]) => Math.hypot(v.x - x, v.z - z) < 1.5)).toBe(true);
    a.dispose();
  });
  it('Sawmill: the mech and the shadows stay on the platform', () => {
    const a = new Arena(0, 0, undefined, [], 'sawmill');
    a.mech.z = -18.5; // south of the pillar at (0, −15), clear of the saw track at z = −8
    a.addShadow(0, 18, -18, 1, 0);
    run(a, 4, [], { ...REST_MECH, mx: 1 });
    expect(a.mech.x).toBeLessThanOrEqual(22 - MECH.radius + 1e-6);
    expect(a.shadows).toHaveLength(1);
    const p = a.shadows[0]!.body.translation();
    expect(Math.abs(p.x)).toBeLessThanOrEqual(22);
    expect(p.y).toBeGreaterThan(-0.5);
    a.dispose();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/maps.test.ts`
Expected: FAIL (`../src/sim/maps.ts` does not exist).

- [ ] **Step 3: Implement the floor switch in `src/sim/bowl.ts`**

Change the import to `import { ARENA, MECH } from '../tuning.ts';` and replace `surfaceHeight` with:

```ts
/** The active map's floor: the oval bowl, or a flat convex polygon (x, z corners in order) at height 0. */
export type Floor = { kind: 'bowl' } | { kind: 'flat'; outline: [number, number][]; open: boolean };
interface Edge { nx: number; nz: number; d: number }
let floor: Floor = { kind: 'bowl' };
/** Outward edge planes of a flat outline: a point is inside when x·nx + z·nz ≤ d for every edge. */
let edges: Edge[] = [];

function outlineEdges(pts: [number, number][]): Edge[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    let nx = b[1] - a[1], nz = a[0] - b[0];
    const len = Math.hypot(nx, nz) || 1;
    nx /= len; nz /= len;
    if ((a[0] - cx) * nx + (a[1] - cz) * nz < 0) { nx = -nx; nz = -nz; }
    return { nx, nz, d: a[0] * nx + a[1] * nz };
  });
}
export function setFloor(f: Floor): void { floor = f; edges = f.kind === 'flat' ? outlineEdges(f.outline) : []; }
export function activeFloor(): Floor { return floor; }

export function surfaceHeight(x: number, z: number): number { return floor.kind === 'bowl' ? bowlHeight(rho(x, z)) : 0; }
/** True when (x, z) is over the floor. The bowl has no edge to fall from. */
export function onFloor(x: number, z: number): boolean { return floor.kind === 'bowl' || edges.every(e => x * e.nx + z * e.nz <= e.d); }

/**
 * Keeps a point at least `inset` inside the floor's edge (on the bowl: inside the rim). Returns the corrected
 * point and the outward normal of the edge it crossed most, or null when it was inside.
 */
export function clampInside(x: number, z: number, inset: number): { x: number; z: number; nx: number; nz: number } | null {
  if (floor.kind === 'bowl') return clampOval(x, z, ARENA.rimRadius - inset);
  let moved = false, nx = 0, nz = 0, worst = 0;
  // Near a corner two edges push; a few passes settle it.
  for (let pass = 0; pass < 3; pass++) {
    let any = false;
    for (const e of edges) {
      const over = x * e.nx + z * e.nz - (e.d - inset);
      if (over <= 1e-9) continue;
      x -= over * e.nx; z -= over * e.nz; any = moved = true;
      if (over > worst) { worst = over; nx = e.nx; nz = e.nz; }
    }
    if (!any) break;
  }
  return moved ? { x, z, nx, nz } : null;
}
/** Keeps the mech's centre inside: below the steep rim on the bowl, one mech radius inside a flat edge. */
export function clampMech(x: number, z: number): { x: number; z: number; nx: number; nz: number } | null {
  return floor.kind === 'bowl' ? clampOval(x, z, MECH.maxRadius) : clampInside(x, z, MECH.radius);
}
```

- [ ] **Step 4: Create `src/sim/maps.ts`**

```ts
import cityLayout from '../arena-layout.json';
import type { Floor } from './bowl.ts';

/** The maps the host can pick. City Bowl comes from src/arena-layout.json (shared with Blender); the others are flat. */
export type MapId = 'city' | 'yard' | 'sawmill' | 'bumpers';
export const MAP_IDS: readonly MapId[] = ['city', 'yard', 'sawmill', 'bumpers'];
export function readMapId(v: unknown): MapId | null { return (MAP_IDS as readonly unknown[]).includes(v) ? v as MapId : null; }

/** Same format as src/arena-layout.json. Tunnel and tree shapes are shared by every map. */
export type Layout = typeof cityLayout;
/** A conveyor belt: centre, length along `angle` (degrees, +X toward +Z), width across. It carries things toward +angle. */
export interface Belt { x: number; z: number; length: number; width: number; angle: number }
/** A saw blade that moves back and forth between two points; one full trip there and back takes `period` seconds. */
export interface Saw { from: [number, number]; to: [number, number]; period: number }
export interface MapDef {
  id: MapId; name: string; blurb: string;
  floor: Floor; layout: Layout; mechStart: [number, number];
  belts: Belt[]; saws: Saw[]; bumpers: [number, number][];
}

const flat = (part: Pick<Layout, 'spawns' | 'walls' | 'buildings'> & Partial<Pick<Layout, 'trees'>>): Layout =>
  ({ ...cityLayout, note: '', tunnels: [], trees: [], ...part });
const ring = (n: number, radius: number, startDeg: number): [number, number][] => Array.from({ length: n }, (_, k) => {
  const a = ((startDeg + (360 / n) * k) * Math.PI) / 180;
  return [Math.round(Math.cos(a) * radius * 100) / 100, Math.round(Math.sin(a) * radius * 100) / 100];
});

export const MAPS: Record<MapId, MapDef> = {
  city: {
    id: 'city', name: 'City Bowl', blurb: 'A city in an oval bowl: buildings, tunnels and trees to hide behind.',
    floor: { kind: 'bowl' }, layout: cityLayout, mechStart: [0, 0], belts: [], saws: [], bumpers: [],
  },
  yard: {
    id: 'yard', name: 'Conveyor Yard', blurb: 'Conveyor belts carry you fast one way and slow you down the other way.',
    floor: { kind: 'flat', outline: [[-30, -20], [30, -20], [30, 20], [-30, 20]], open: false },
    layout: flat({
      spawns: [[-26, -16], [26, 16], [26, -16], [-26, 16]],
      walls: [{ x: 0, z: -16, length: 6, angle: 0 }, { x: 0, z: 16, length: 6, angle: 0 }],
      buildings: [
        { x: -14, z: 0, w: 4, d: 4, h: 3 }, { x: 14, z: 0, w: 4, d: 4, h: 3 },
        { x: -26, z: 0, w: 3, d: 6, h: 4 }, { x: 26, z: 0, w: 3, d: 6, h: 4 },
      ],
    }),
    mechStart: [0, 0],
    // A loop around the yard (clockwise on screen) and two short belts through the middle, opposite ways.
    belts: [
      { x: 0, z: -12, length: 44, width: 3, angle: 0 }, { x: 22, z: 0, length: 24, width: 3, angle: 90 },
      { x: 0, z: 12, length: 44, width: 3, angle: 180 }, { x: -22, z: 0, length: 24, width: 3, angle: 270 },
      { x: -6, z: 0, length: 14, width: 3, angle: 90 }, { x: 6, z: 0, length: 14, width: 3, angle: 270 },
    ],
    saws: [], bumpers: [],
  },
  sawmill: {
    id: 'sawmill', name: 'Sawmill', blurb: 'A platform with open edges and moving saw blades. A top that falls comes back after 3 s.',
    floor: { kind: 'flat', outline: [[-22, -22], [22, -22], [22, 22], [-22, 22]], open: true },
    layout: flat({
      spawns: [[-16, -15], [16, 15], [16, -15], [-16, 15]],
      // Short rails in the middle of each edge; the corners are open.
      walls: [
        { x: 0, z: -21.6, length: 14, angle: 0 }, { x: 0, z: 21.6, length: 14, angle: 0 },
        { x: -21.6, z: 0, length: 14, angle: 90 }, { x: 21.6, z: 0, length: 14, angle: 90 },
      ],
      buildings: [
        { x: -8, z: 0, w: 3, d: 3, h: 4 }, { x: 8, z: 0, w: 3, d: 3, h: 4 },
        { x: 0, z: -15, w: 4, d: 2, h: 3 }, { x: 0, z: 15, w: 4, d: 2, h: 3 },
      ],
    }),
    mechStart: [0, 0], belts: [],
    saws: [{ from: [-15, -8], to: [15, -8], period: 6 }, { from: [15, 8], to: [-15, 8], period: 7 }],
    bumpers: [],
  },
  bumpers: {
    id: 'bumpers', name: 'Bumper Park', blurb: 'Pinball bumpers kick tops away at high speed.',
    floor: { kind: 'flat', outline: ring(8, 26, 22.5), open: false },
    layout: flat({ spawns: [[-17.32, -10], [17.32, -10], [0, 20], [-20, 0]], walls: [], buildings: [] }),
    mechStart: [0, 0], belts: [], saws: [],
    bumpers: [...ring(6, 9, 0), ...ring(3, 18, 30)],
  },
};
```

- [ ] **Step 5: Make `src/sim/city.ts` map-aware**

Replace the top of the file down to (not including) `export interface Tree` with:

```ts
import cityLayout from '../arena-layout.json';
import { setFloor, surfaceHeight, type MeshData } from './bowl.ts';
import { MAPS, type Layout, type MapDef, type MapId } from './maps.ts';

/**
 * The active map's obstacles: buildings, half walls, tunnels and trees (see src/sim/maps.ts). They are live
 * bindings that setMap rebuilds; only one map is active in a browser tab at a time.
 * Everything sits on the floor. Positions are game metres; angles turn +X toward +Z.
 */

/** A box standing on the floor: centre, half extents along its length (hx), height (hy) and depth (hz). */
export interface Box { x: number; y: number; z: number; hx: number; hy: number; hz: number; angle: number; dirX: number; dirZ: number; top: number }

function drapedBox(x: number, z: number, length: number, depth: number, height: number, angleDeg: number): Box {
  // (body unchanged)
}
```
(keep the existing `drapedBox` body).

Then replace the `WALLS`/`BUILDINGS`/`SPAWNS`/`TREE`/`TREES`/`TUNNEL`/`TUNNELS`/`TUNNEL_BOXES` declarations with:

```ts
export interface Tree { x: number; z: number; base: number }
export interface Tunnel { x: number; z: number; angle: number; dirX: number; dirZ: number }
/** Tunnel and tree shapes are the same on every map. */
export const TREE = cityLayout.tree;
export const TUNNEL = cityLayout.tunnel;

export let MAP: MapDef = MAPS.city;
export let WALLS: Box[] = [];
export let BUILDINGS: Box[] = [];
export let SPAWNS: [number, number][] = [];
export let TREES: Tree[] = [];
export let TUNNELS: Tunnel[] = [];
/** A tunnel's footprint as a box: on the ground the mech is blocked by it; it must jump or hover onto the roof. */
export let TUNNEL_BOXES: Box[] = [];
/** The rim of a closed flat map: one wall box outside each edge of the outline. Empty on the bowl and open maps. */
export let RIM: Box[] = [];

const RIM_HEIGHT = 4, RIM_THICKNESS = 1;
function rimBoxes(outline: [number, number][]): Box[] {
  const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length, cz = outline.reduce((s, p) => s + p[1], 0) / outline.length;
  return outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length]!, dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    let nx = dz / len, nz = -dx / len;
    if (((a[0] + b[0]) / 2 - cx) * nx + ((a[1] + b[1]) / 2 - cz) * nz < 0) { nx = -nx; nz = -nz; }
    const x = (a[0] + b[0]) / 2 + nx * RIM_THICKNESS / 2, z = (a[1] + b[1]) / 2 + nz * RIM_THICKNESS / 2;
    return drapedBox(x, z, len + RIM_THICKNESS, RIM_THICKNESS, RIM_HEIGHT, (Math.atan2(dz, dx) * 180) / Math.PI);
  });
}

/** Makes `id` the active map: its floor, obstacles and spawn points. */
export function setMap(id: MapId): void {
  const map = MAPS[id], l: Layout = map.layout;
  MAP = map;
  setFloor(map.floor);
  WALLS = l.walls.map(w => drapedBox(w.x, w.z, w.length, l.wall.thickness, l.wall.height, w.angle));
  BUILDINGS = l.buildings.map(b => drapedBox(b.x, b.z, b.w, b.d, b.h, 0));
  SPAWNS = l.spawns.map(([x, z]) => [x!, z!]);
  TREES = l.trees.map(([x, z]) => ({ x: x!, z: z!, base: surfaceHeight(x!, z!) }));
  TUNNELS = l.tunnels.map(t => {
    const angle = (t.angle * Math.PI) / 180;
    return { x: t.x, z: t.z, angle, dirX: Math.cos(angle), dirZ: Math.sin(angle) };
  });
  TUNNEL_BOXES = TUNNELS.map(t => ({
    x: t.x, y: 0, z: t.z, hx: TUNNEL.length / 2, hy: 0, hz: -TUNNEL.outer[0]![0]!, angle: t.angle, dirX: t.dirX, dirZ: t.dirZ, top: 0,
  }));
  RIM = map.floor.kind === 'flat' && !map.floor.open ? rimBoxes(map.floor.outline) : [];
}
setMap('city');
```
(delete the old `export interface Tunnel` line further down if it is now duplicated; no other code in the file changes, because it already reads `TUNNEL`, `TUNNELS` and `TREE`.)

- [ ] **Step 6: Make `Arena` map-aware and add falling** — `src/sim/arena.ts`:

Imports:

```ts
import { ARENA, FALL, MATCH, MECH, SHADOW, TOP } from '../tuning.ts';
import { activeFloor, bowlMesh, clampInside, clampMech, onFloor, surfaceHeight, wallMesh } from './bowl.ts';
import {
  BUILDINGS, hitsBuilding, MAP, pushOutOfBox, pushOutOfTree, RIM, setMap, SPAWNS, TREE, TREES, TUNNEL_BOXES, TUNNELS, tunnelLift, tunnelSolids, WALLS,
} from './city.ts';
import type { MapId } from './maps.ts';
```

`GameEvent` union: add `| { k: 'fall'; top: number } | { k: 'respawn'; top: number }`.

`interface Top`: add `/** −1 while in play; after a fall, the time it respawns. */ outUntil: number;` and `outUntil: -1` in `addTop`.

`TopView`: add `/** True while the top has fallen off and waits to respawn. */ out: boolean;` and in `view()`: `out: t.outUntil >= 0,`.

Replace `contain`:

```ts
/**
 * Keeps a ball inside the arena: a speed up the steep rim (or into a flat map's rim) must not carry it out.
 * A top on an open map may leave the floor and fall; a shadow never does.
 */
function contain(body: RAPIER.RigidBody, radius: number, restitution: number, canFall: boolean): void {
  const p = body.translation(), v = body.linvel(), floor = activeFloor();
  let { x, y, z } = p, { x: vx, y: vy, z: vz } = v, changed = false;
  const falls = canFall && floor.kind === 'flat' && floor.open;
  const out = falls ? null : clampInside(p.x, p.z, radius);
  if (out) {
    x = out.x; z = out.z;
    const along = vx * out.nx + vz * out.nz;
    if (along > 0) { vx -= (1 + restitution) * along * out.nx; vz -= (1 + restitution) * along * out.nz; }
    changed = true;
  }
  if (floor.kind === 'bowl' && y > ARENA.rimHeight + RIM_CLEARANCE && vy > 0) { vy = 0; changed = true; }
  // A ball that sinks a little into the floor comes back up; one that fell past an open edge keeps falling.
  const ground = surfaceHeight(x, z);
  if (onFloor(x, z) && y < ground - radius && (!falls || y > ground - radius - 1)) { y = ground + radius; vy = Math.max(0, vy); changed = true; }
  if (!changed) return;
  body.setTranslation({ x, y, z }, true);
  body.setLinvel({ x: vx, y: vy, z: vz }, true);
}
```

Constructor: add the parameter and build the floor per map:

```ts
  constructor(topCount: number, countdown = MATCH.countdown, kit: MechKit = DEFAULT_KIT, abilities: readonly TopAbility[] = [], map: MapId = 'city') {
    setMap(map);
    this.clock = -countdown;
    …
    const floor = activeFloor();
    if (floor.kind === 'bowl') {
      const bowl = bowlMesh();
      solid(RAPIER.ColliderDesc.trimesh(bowl.vertices, bowl.indices), 0, RAPIER.CoefficientCombineRule.Min);
      const rim = wallMesh();
      solid(RAPIER.ColliderDesc.trimesh(rim.vertices, rim.indices), 1, RAPIER.CoefficientCombineRule.Max);
    } else {
      // A slab under the outline, 2 m deep.
      const pts: number[] = [];
      for (const [x, z] of floor.outline) pts.push(x, 0, z, x, -2, z);
      const slab = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
      if (!slab) throw new Error('The map floor has no convex hull.');
      solid(slab, 0, RAPIER.CoefficientCombineRule.Min);
    }
    for (const w of [...WALLS, ...BUILDINGS, ...RIM]) {
```
(the rest of the obstacle loop is unchanged). Mech start:

```ts
    const [sx, sz] = MAP.mechStart;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(sx, surfaceHeight(sx, sz) + MECH.height / 2, sz));
    …
      body, collider, kit: { ...kit }, x: sx, z: sz, yaw: Math.PI, …
```

`step`: replace the two existing `contain` lines with:

```ts
    for (const t of this.tops) if (t.outUntil < 0) contain(t.body, TOP.radius, TOP.restitution, true);
    for (const sh of this.shadows) contain(sh.body, SHADOW.radius, 1, false);
    this.dropFallen(now);
```

`stepTops`, first lines inside the `forEach`:

```ts
      const input = inputs[i] ?? REST_TOP;
      // A fallen top waits; presses made meanwhile are used up.
      if (top.outUntil >= 0) { top.lastDash = input.dash; return; }
```

Add after `stepTops`:

```ts
  /** A top below the void line is out. After FALL.respawnTime it comes back, still, at the spawn farthest from the mech. */
  private dropFallen(now: number): void {
    this.tops.forEach((top, i) => {
      if (top.outUntil >= 0) {
        if (now < top.outUntil) return;
        top.outUntil = -1;
        const m = this.mech, far = (s: [number, number]) => hyp(s[0] - m.x, s[1] - m.z);
        const [x, z] = SPAWNS.reduce((best, s) => (far(s) > far(best) ? s : best));
        top.body.setEnabled(true);
        top.body.setTranslation({ x, y: surfaceHeight(x, z) + TOP.radius + 0.02, z }, true);
        top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.events.push({ k: 'respawn', top: i });
        return;
      }
      if (top.body.translation().y > FALL.outY) return;
      top.outUntil = now + FALL.respawnTime;
      top.dashUntil = top.flungUntil = top.lockedUntil = top.stunnedUntil = top.empoweredUntil = -1;
      top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      top.body.setEnabled(false);
      this.events.push({ k: 'fall', top: i });
    });
  }
```

Lock and parry skip fallen tops: in the lock `forEach`, first line `if (t.outUntil >= 0) return;`; in `pulse`, `if (top.outUntil < 0 && hyp(…) <= reach) this.fling(…)`; in `resolveHits` top loop, first line `if (top.outUntil >= 0) return;`.

Replace the oval clamps for the mech: in `traceTo`, `const edge = clampMech(best.x, best.z);`; in `isFree`, `if (clampMech(x, z)) return false;`; in `keepMechInside`, `const edge = clampMech(m.x, m.z);` and in `free`, `!clampMech(x, z) &&`.

`src/tuning.ts` — add after `SHADOW`:

```ts
/** Open edges (Sawmill): a top below outY is out, and respawns after respawnTime. */
export const FALL = {
  outY: -6,
  respawnTime: 3,
};
```

- [ ] **Step 7: Run the tests and type check**

Run: `npx vitest run && npx tsc -b`
Expected: all PASS (old arena tests still run on City Bowl, because `new Arena(…)` defaults to `'city'`).

- [ ] **Step 8: Commit**

```bash
git add src tests
git commit -m "Maps: map definitions, flat floors, Conveyor Yard, Sawmill and Bumper Park layouts, falling off open edges"
```

---

### Task 5: Hazards — belts, saws and bumpers

**Files:**
- Modify: `src/tuning.ts`, `src/sim/city.ts`, `src/sim/rules.ts`, `src/sim/arena.ts`
- Test: `tests/maps.test.ts`, `tests/rules.test.ts`

**Interfaces:**
- Produces (`tuning.ts`): `HAZARD` (values in Global Constraints).
- Produces (`city.ts`): live `BELTS: Box[]`, `SAWS: Saw[]`, `BUMPERS: { x: number; z: number }[]`, `POSTS: { x: number; z: number; r: number }[]` (tree trunks and bumpers: round ground obstacles); `beltAt(x, z): { dx: number; dz: number } | null`; `sawPosition(saw, clock): { x: number; z: number }`; `pushOutOfCircle(cx, cz, r, x, z, radius)`.
- Produces (`rules.ts`): `applySawHit(s, now): { pushed: boolean }`.
- Produces (`arena.ts`): events `{ k: 'saw'; x; z }`, `{ k: 'bump'; top; x; z }`.

- [ ] **Step 1: Write the failing tests**

`tests/rules.test.ts` — in `describe('shadow hits', …)` add (import `applySawHit`):

```ts
  it('a saw pushes like a shadow but does not slow, and shares the push immunity', () => {
    const s = createMechStatus();
    expect(applySawHit(s, 1).pushed).toBe(true);
    expect(s.slows).toHaveLength(0);
    expect(hasControl(s, 1.1)).toBe(false);
    expect(applySawHit(s, 1.5).pushed).toBe(false);
    expect(s.health).toBe(MECH.health);
  });
```
(add `createMechStatus`, `hasControl` and `MECH` to the imports if they are not there.)

`tests/maps.test.ts` — add imports `BELTS, BUMPERS, POSTS, SAWS, sawPosition` from city and `HAZARD` from tuning; extend the spawn test's `blocked` helper with `|| POSTS.some(p => Math.hypot(x - p.x, z - p.z) < p.r + r)`; add:

```ts
describe('hazards', () => {
  it('a belt carries a top faster than its normal top speed', () => {
    const a = new Arena(1, 0, undefined, [], 'yard');
    const top = a.tops[0]!, b = BELTS[0]!; // along +X at z = −12
    top.body.setTranslation({ x: b.x - 15, y: TOP.radius + 0.02, z: b.z }, true);
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    let best = 0;
    for (let i = 0; i < 60; i++) { a.step([REST_TOP], REST_MECH); best = Math.max(best, top.body.linvel().x); }
    expect(best).toBeGreaterThan(TOP.maxSpeed + 3);
    expect(best).toBeLessThanOrEqual(HAZARD.beltTopSpeed + 0.5);
    a.dispose();
  });
  it('a belt moves the mech on the ground', () => {
    const a = new Arena(0, 0, undefined, [], 'yard');
    a.mech.x = -10; a.mech.z = -12;
    run(a, 1);
    expect(a.mech.x).toBeGreaterThan(-10 + HAZARD.beltMechSpeed * 0.8);
    a.dispose();
  });
  it('a saw throws a top away and pushes the mech without damage', () => {
    const a = new Arena(1, 0, undefined, [], 'sawmill');
    const c = sawPosition(SAWS[0]!, a.clock + 1 / 60);
    const top = a.tops[0]!;
    top.body.setTranslation({ x: c.x, y: TOP.radius + 0.02, z: c.z + 1.5 }, true);
    top.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    a.step([REST_TOP], REST_MECH);
    expect(a.drainEvents().some(e => e.k === 'saw')).toBe(true);
    expect(Math.hypot(top.body.linvel().x, top.body.linvel().z)).toBeGreaterThan(HAZARD.sawThrow - 3);
    const m = new Arena(0, 0, undefined, [], 'sawmill');
    const c2 = sawPosition(SAWS[0]!, m.clock + 1 / 60);
    m.mech.x = c2.x; m.mech.z = c2.z + 2;
    m.step([], REST_MECH);
    expect(m.view().mech.control).toBe(false);
    expect(m.mech.status.health).toBe(MECH.health);
    expect(m.mech.status.slows).toHaveLength(0);
    a.dispose(); m.dispose();
  });
  it('a bumper kicks a top away and blocks the mech', () => {
    const a = new Arena(1, 0, undefined, [], 'bumpers');
    const b = BUMPERS[0]!, top = a.tops[0]!;
    top.body.setTranslation({ x: b.x + 3, y: TOP.radius + 0.02, z: b.z }, true);
    top.body.setLinvel({ x: -6, y: 0, z: 0 }, true);
    let kicked = false;
    for (let i = 0; i < 60 && !kicked; i++) { a.step([REST_TOP], REST_MECH); kicked = a.drainEvents().some(e => e.k === 'bump'); }
    expect(kicked).toBe(true);
    expect(top.body.linvel().x).toBeGreaterThan(HAZARD.bumperKick - 3);
    a.mech.x = b.x - 5; a.mech.z = b.z;
    run(a, 1.5, [REST_TOP], { ...REST_MECH, mx: 1 });
    expect(Math.hypot(a.mech.x - b.x, a.mech.z - b.z)).toBeGreaterThanOrEqual(HAZARD.bumperRadius + MECH.radius - 0.01);
    a.dispose();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/maps.test.ts tests/rules.test.ts`
Expected: FAIL (`HAZARD`, `BELTS`, `applySawHit` missing).

- [ ] **Step 3: Implement**

`src/tuning.ts` — add after `FALL`:

```ts
/** Map hazards. */
export const HAZARD = {
  /** A belt pushes a top along it with this acceleration, up to this speed (more than TOP.maxSpeed). */
  beltTopSpeed: 18,
  beltAccel: 30,
  /** Extra speed of the mech on the ground along a belt. */
  beltMechSpeed: 5,
  sawRadius: 1.6,
  /** A saw throws a top away from the blade at this speed. */
  sawThrow: 30,
  bumperRadius: 1.4,
  /** A top leaves a bumper at this speed or more. */
  bumperKick: 24,
};
```

`src/sim/rules.ts` — after `applyShadowHit`:

```ts
/** A saw pushes the mech like a shadow, with no slow and no damage. It shares the push immunity. */
export function applySawHit(s: MechStatus, now: number): { pushed: boolean } {
  if (dead(s) || now < s.pushImmuneUntil) return { pushed: false };
  s.controlLostUntil = now + MECH.controlLoss;
  s.pushImmuneUntil = now + MECH.pushImmunity;
  return { pushed: true };
}
```

`src/sim/city.ts`:
- Imports: add `import { HAZARD } from '../tuning.ts';` and `type Saw` from `./maps.ts`.
- Declarations after `RIM`:

```ts
/** Conveyor belts as flat boxes; each carries things toward (dirX, dirZ). */
export let BELTS: Box[] = [];
export let SAWS: Saw[] = [];
export let BUMPERS: { x: number; z: number }[] = [];
/** Round obstacles on the ground that block the walking mech: tree trunks and bumpers. */
export let POSTS: { x: number; z: number; r: number }[] = [];
```
- In `setMap`, at the end:

```ts
  BELTS = map.belts.map(b => drapedBox(b.x, b.z, b.length, b.width, 0.05, b.angle));
  SAWS = map.saws;
  BUMPERS = map.bumpers.map(([x, z]) => ({ x, z }));
  POSTS = [...TREES.map(t => ({ x: t.x, z: t.z, r: TREE.trunk })), ...BUMPERS.map(b => ({ ...b, r: HAZARD.bumperRadius }))];
```
- New functions (replace `pushOutOfTree`):

```ts
/** Pushes a circle of `radius` at (x, z) out of a round post of radius r at (cx, cz). */
export function pushOutOfCircle(cx: number, cz: number, r: number, x: number, z: number, radius: number): { x: number; z: number; nx: number; nz: number } | null {
  const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz), min = radius + r;
  if (d >= min) return null;
  const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
  return { x: cx + nx * min, z: cz + nz * min, nx, nz };
}
/** Pushes a circle out of a tree trunk. */
export function pushOutOfTree(t: Tree, x: number, z: number, radius: number): { x: number; z: number; nx: number; nz: number } | null {
  return pushOutOfCircle(t.x, t.z, TREE.trunk, x, z, radius);
}
/** The direction of the belt under (x, z), or null. */
export function beltAt(x: number, z: number): { dx: number; dz: number } | null {
  for (const b of BELTS) {
    const dx = x - b.x, dz = z - b.z, u = dx * b.dirX + dz * b.dirZ, v = -dx * b.dirZ + dz * b.dirX;
    if (Math.abs(u) <= b.hx && Math.abs(v) <= b.hz) return { dx: b.dirX, dz: b.dirZ };
  }
  return null;
}
/** Where a saw is at a round clock time. It waits at `from` during the countdown, so every client can draw it. */
export function sawPosition(saw: Saw, clock: number): { x: number; z: number } {
  const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * Math.max(0, clock)) / saw.period);
  return { x: saw.from[0] + (saw.to[0] - saw.from[0]) * k, z: saw.from[1] + (saw.to[1] - saw.from[1]) * k };
}
```

`src/sim/arena.ts`:
- Imports: `HAZARD` from tuning; from city add `beltAt, BUMPERS, POSTS, pushOutOfCircle, SAWS, sawPosition`, and drop `pushOutOfTree` and `TREES` if no longer used (the trunk colliders loop still uses `TREES` and `TREE`, keep those); from rules add `applySawHit`.
- `GameEvent`: add `| { k: 'saw'; x: number; z: number } | { k: 'bump'; top: number; x: number; z: number }`.
- Constructor, after the trees loop:

```ts
    for (const b of BUMPERS) {
      solid(RAPIER.ColliderDesc.cylinder(0.5, HAZARD.bumperRadius).setTranslation(b.x, 0.5, b.z), 1, RAPIER.CoefficientCombineRule.Max);
    }
```
- `step`:

```ts
    this.stepTops(tops, now);
    this.applyBelts(now);
    this.stepMech(mech, now);
    …
    this.world.step();
    this.endBlockedDashes();
    this.keepShadowSpeed();
    for (const t of this.tops) if (t.outUntil < 0) contain(t.body, TOP.radius, TOP.restitution, true);
    for (const sh of this.shadows) contain(sh.body, SHADOW.radius, 1, false);
    this.applyBumpers();
    this.applySaws(now);
    this.dropFallen(now);
```
- New methods (put them in a `// ---------- Hazards ----------` section before `// ---------- Mech ----------`):

```ts
  /** Belts push a rolling top along them, up to HAZARD.beltTopSpeed. A top in the air or locked is not moved. */
  private applyBelts(now: number): void {
    if (!this.hasBelts) return;
    for (const top of this.tops) {
      if (top.outUntil >= 0 || now < top.lockedUntil) continue;
      const p = top.body.translation();
      if (p.y > surfaceHeight(p.x, p.z) + TOP.radius + 0.4) continue;
      const belt = beltAt(p.x, p.z);
      if (!belt) continue;
      const v = top.body.linvel(), along = v.x * belt.dx + v.z * belt.dz;
      if (along >= HAZARD.beltTopSpeed) continue;
      const add = Math.min(HAZARD.beltAccel * DT, HAZARD.beltTopSpeed - along);
      top.body.setLinvel({ x: v.x + belt.dx * add, y: v.y, z: v.z + belt.dz * add }, true);
    }
  }

  /** A top that touches a bumper leaves it at HAZARD.bumperKick or more. Shadows bounce off its collider. */
  private applyBumpers(): void {
    for (const b of BUMPERS) this.tops.forEach((top, i) => {
      if (top.outUntil >= 0) return;
      const p = top.body.translation(), dx = p.x - b.x, dz = p.z - b.z, d = hyp(dx, dz);
      if (d > HAZARD.bumperRadius + TOP.radius + 0.15 || d < 0.01) return;
      const v = top.body.linvel(), nx = dx / d, nz = dz / d, out = v.x * nx + v.z * nz;
      if (out >= HAZARD.bumperKick) return;
      top.dashUntil = -1;
      const add = HAZARD.bumperKick - out;
      top.body.setLinvel({ x: v.x + add * nx, y: v.y, z: v.z + add * nz }, true);
      this.events.push({ k: 'bump', top: i, x: b.x, z: b.z });
    });
  }

  /** Saws throw tops away and push the mech (no damage). They do not touch shadows. */
  private applySaws(now: number): void {
    const m = this.mech;
    for (const saw of SAWS) {
      const c = sawPosition(saw, now);
      for (const top of this.tops) {
        if (top.outUntil >= 0 || now < top.flungUntil) continue;
        const p = top.body.translation(), dx = p.x - c.x, dz = p.z - c.z, d = hyp(dx, dz);
        if (d > HAZARD.sawRadius + TOP.radius || p.y > surfaceHeight(p.x, p.z) + 1.5) continue;
        const nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0;
        top.dashUntil = -1; top.flungUntil = now + 0.5;
        top.body.setLinvel({ x: nx * HAZARD.sawThrow, y: 3, z: nz * HAZARD.sawThrow }, true);
        this.events.push({ k: 'saw', x: p.x, z: p.z });
      }
      if (this.airborne) continue;
      const dx = m.x - c.x, dz = m.z - c.z, d = hyp(dx, dz);
      if (d > HAZARD.sawRadius + MECH.radius || !applySawHit(m.status, now).pushed) continue;
      const nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0;
      m.pushX = nx * MECH.pushSpeed; m.pushZ = nz * MECH.pushSpeed; m.vx = m.vz = 0; m.moveUntil = -1; m.hovering = false;
      this.events.push({ k: 'saw', x: m.x, z: m.z });
    }
  }
```
  with a field `private readonly hasBelts: boolean;` set in the constructor after `setMap`: `this.hasBelts = MAP.belts.length > 0;`.
- `stepMech`, the position update:

```ts
    // A belt carries the mech on the ground (not on a tunnel roof or in the air).
    const belt = this.airborne || m.onTunnel ? null : beltAt(m.x, m.z);
    const bx = belt ? belt.dx * HAZARD.beltMechSpeed : 0, bz = belt ? belt.dz * HAZARD.beltMechSpeed : 0;
    m.x += (m.vx + m.pushX + pullX + bx) * DT; m.z += (m.vz + m.pushZ + pullZ + bz) * DT;
```
- Use `POSTS` (trunks and bumpers) for the walking mech: in `isFree`, `if (POSTS.some(p => pushOutOfCircle(p.x, p.z, p.r, x, z, MECH.radius))) return false;`; in `keepMechInside`, `const posts = onGround ? POSTS : [];` and the loop

```ts
      for (const p of posts) {
        const hit = pushOutOfCircle(p.x, p.z, p.r, m.x, m.z, MECH.radius);
        if (hit) { m.x = hit.x; m.z = hit.z; this.blockMech(-hit.nx, -hit.nz); moved = true; }
      }
```
  and in `free`: `posts.every(p => !pushOutOfCircle(p.x, p.z, p.r, x, z, MECH.radius))`.

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run && npx tsc -b`
Expected: all PASS, including `performance` (City Bowl has no hazards).

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "Hazards: conveyor belts, saw blades and pinball bumpers"
```

---

### Task 6: Map choice in the lobby and best times per map

**Files:**
- Modify: `src/net/protocol.ts`, `src/session.ts`, `src/render/hud.ts`, `src/main.ts` (map buttons only; the scene hook is in Task 7), `index.html`, `src/style.css`
- Test: `tests/session.test.ts`

**Interfaces:**
- Consumes: `MapId`, `MAP_IDS`, `MAPS`, `readMapId` (Task 4).
- Produces: `Lobby.map: MapId`; `Lobby.scores: Record<MapId, ScoreEntry[]>`; `readScores(v2: unknown, old: unknown): Record<MapId, ScoreEntry[]>` (exported from `session.ts`); `HostSession.chooseMap(map: MapId)`; `scoreList` shows the current map's list.

- [ ] **Step 1: Write the failing tests** — add to `tests/session.test.ts` (import `readScores`):

```ts
describe('best times per map', () => {
  it('reads saved times per map, and moves the old single list to City Bowl', () => {
    const e = { name: 'Ava', tops: 2, time: 61.5, date: '2026-10-01' };
    expect(readScores(null, [e, { bad: 1 }]).city).toEqual([e]);
    expect(readScores(null, null).sawmill).toEqual([]);
    expect(readScores({ yard: [e] }, [e]).city).toEqual([]);
    expect(readScores({ yard: [e] }, null).yard).toEqual([e]);
  });
  it('plays the chosen map and records the time under it', () => {
    const room = fakeRoom();
    const host = new HostSession('h', 'Dad', room as unknown as Room);
    room.onGuestJoin('g', 'Ava');
    room.onGuestMessage('g', { t: 'ready', ready: true });
    host.setReady(true);
    host.chooseMap('sawmill');
    expect(host.lobby.map).toBe('sawmill');
    host.start(0);
    expect(host.arena!.view().tops).toHaveLength(1);
    host.arena!.mech.status.health = 0;
    host.update(1 / 60, () => REST_MECH);
    expect(host.lobby.phase).toBe('over');
    expect(host.lobby.scores.sawmill).toHaveLength(1);
    expect(host.lobby.scores.city).toHaveLength(0);
    host.backToLobby();
    host.chooseMap('moon' as never);
    expect(host.lobby.map).toBe('sawmill');
  });
});
```
(remove the `void REST_MECH;` line from Task 3's test.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL (`readScores`, `chooseMap` missing).

- [ ] **Step 3: Implement**

`src/net/protocol.ts`: import `type MapId` from `../sim/maps.ts`; `Lobby` becomes

```ts
export interface Lobby {
  phase: Phase; players: LobbyPlayer[]; map: MapId;
  /** Best times for each map. */ scores: Record<MapId, ScoreEntry[]>;
  /** Player id for each top slot, in arena order. */ tops: string[]; mech: string; lastTime: number; lastRank: number;
}
```

`src/session.ts`:

```ts
import { MAP_IDS, readMapId, type MapId } from './sim/maps.ts';

const SCORE_KEY = 'spin-arena-scores-v2', OLD_SCORE_KEY = 'spin-arena-scores';
type ScoreBoard = Record<MapId, ScoreEntry[]>;
const validEntry = (s: unknown): s is ScoreEntry => !!s && typeof (s as ScoreEntry).time === 'number' && typeof (s as ScoreEntry).name === 'string';

/** Saved best times: one list per map. The old single list (before maps) belongs to City Bowl. */
export function readScores(v2: unknown, old: unknown): ScoreBoard {
  const take = (list: unknown) => (Array.isArray(list) ? list.filter(validEntry).slice(0, MATCH.highScores) : []);
  const board = Object.fromEntries(MAP_IDS.map(id => [id, [] as ScoreEntry[]])) as ScoreBoard;
  if (v2 && typeof v2 === 'object') for (const id of MAP_IDS) board[id] = take((v2 as Record<string, unknown>)[id]);
  else board.city = take(old);
  return board;
}
function loadScores(): ScoreBoard {
  const parse = (key: string): unknown => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
  return readScores(parse(SCORE_KEY), parse(OLD_SCORE_KEY));
}
function saveScores(board: ScoreBoard): void { try { localStorage.setItem(SCORE_KEY, JSON.stringify(board)); } catch { /* storage unavailable */ } }
```
(replaces the old `loadScores`/`saveScores`.) Host constructor lobby literal: add `map: 'city'`. New method:

```ts
  /** The host picks the map in the lobby. */
  chooseMap(map: MapId): void {
    const id = readMapId(map);
    if (!id || this.lobby.phase !== 'lobby') return;
    this.lobby.map = id;
    this.changed();
  }
```
`start`: `this.arena = new Arena(tops.length, countdown, mech.kit, tops.map(p => ringAbility(p.look.mid)), this.lobby.map);`
`finish`:

```ts
      const result = insertScore(this.lobby.scores[this.lobby.map], entry);
      this.lobby.scores[this.lobby.map] = result.list; this.lobby.lastRank = result.rank;
      saveScores(this.lobby.scores);
```

`src/render/hud.ts` `scoreList`:

```ts
export function scoreList(el: HTMLElement, lobby: Lobby, highlight = -1): void {
  const list = lobby.scores[lobby.map] ?? [];
  el.innerHTML = list.length ? list.map((s, i) =>
    `<li class="${i === highlight ? 'mine' : ''}">${formatTime(s.time)} — ${esc(s.name)} vs ${s.tops} top${s.tops === 1 ? '' : 's'} <span class="when">${esc(s.date)}</span></li>`).join('') : '<li>No runs yet.</li>';
}
```

`index.html` lobby: after the `.teams` row:

```html
    <div id="maps" class="row maps">
      <span>Map</span>
      <button data-map="city">City Bowl</button>
      <button data-map="yard">Conveyor Yard</button>
      <button data-map="sawmill">Sawmill</button>
      <button data-map="bumpers">Bumper Park</button>
    </div>
    <p id="mapBlurb" class="tag"></p>
```
and change `<div><h3>Best survival times</h3>` to `<div><h3 id="scoresTitle">Best survival times</h3>`.

`src/style.css`: `.maps { flex-wrap: wrap; align-items: center; gap: 6px; } .maps button.selected { border-color: var(--accent); }` and in the short-screen block add `'maps custom'` after `'teams custom'` in the areas, plus `#maps { grid-area: maps; } #mapBlurb { display: none; }`.

`src/main.ts`:
- Import `MAPS, type MapId` from `./sim/maps.ts`.
- `for (const b of document.querySelectorAll<HTMLButtonElement>('[data-map]')) b.onclick = () => { if (session instanceof HostSession) session.chooseMap(b.dataset.map as MapId); };`
- In `renderLobby`, after `scoreList($('scores'), lobby);`:

```ts
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-map]')) { b.classList.toggle('selected', b.dataset.map === lobby.map); b.disabled = !hosting; }
  $('mapBlurb').textContent = MAPS[lobby.map].blurb + (hosting ? '' : ' The host picks the map.');
  $('scoresTitle').textContent = `Best times: ${MAPS[lobby.map].name}`;
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run && npx tsc -b`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests index.html
git commit -m "Lobby: the host picks the map; best times are kept per map"
```

---

### Task 7: Draw the maps — floors, rims, belts, saws, bumpers, falling tops

**Files:**
- Modify: `src/render/scene.ts`, `src/main.ts`, `src/sim/bots.ts`, `src/audio.ts`, `src/render/hud.ts`

**Interfaces:**
- Consumes: `setMap`, `MAP`, `RIM`, `BELTS`, `SAWS`, `BUMPERS`, `POSTS`, `sawPosition`, `pushOutOfCircle` (city.ts); `activeFloor`, `clampInside`, `surfaceHeight` (bowl.ts); `TopView.out`; events `saw`, `bump`, `fall`, `respawn`.
- Produces: `Scene.setMap(id: MapId)` (calls city `setMap(id)` first, then rebuilds the arena meshes; the newest call wins); `Scene.mapId` (read-only, for e2e).

- [ ] **Step 1: Scene map switching** — `src/render/scene.ts`:
- Imports: `import { activeFloor, bowlMesh, rho, surfaceHeight } from '../sim/bowl.ts';` (drop `bowlHeight`), from city add `BELTS, BUMPERS, MAP, RIM, SAWS, sawPosition, setMap`, `import type { MapId } from '../sim/maps.ts';`, and `HAZARD` from tuning.
- Fields:

```ts
  private arenaRoot: THREE.Object3D | null = null;
  private builds = 0;
  mapId: MapId = 'city';
  private beltTextures: THREE.Texture[] = [];
  private sawMeshes: THREE.Object3D[] = [];
  private bumperMeshes: { mesh: THREE.Mesh; flash: number }[] = [];
```
- Constructor: replace `void this.buildArena();` with `void this.buildArena('city');`.
- New public method and the new `buildArena`:

```ts
  /** Makes `id` the active map (for picking and hiding too) and rebuilds the arena meshes. */
  setMap(id: MapId): void {
    if (id === this.mapId && this.arenaRoot) return;
    setMap(id);
    this.mapId = id;
    void this.buildArena(id);
  }

  private async buildArena(id: MapId): Promise<void> {
    const build = ++this.builds;
    const glb = id === 'city' ? await loadArena() : null;
    if (build !== this.builds) return; // a newer map was picked while this one loaded
    if (this.arenaRoot) this.scene.remove(this.arenaRoot);
    this.roofs = []; this.canopies = []; this.blocks = [];
    this.beltTextures = []; this.sawMeshes = []; this.bumperMeshes = [];
    const root = glb ?? this.fallbackArena();
    this.arenaRoot = root;
    this.scene.add(root);
    // (the existing `faders` helper and its three calls follow unchanged)
  }
```
(`loadArena` returns the same cached group each time, so it is not disposed; the fallback groups are small, so they are left to the garbage collector.)
- `fallbackArena`: the floor depends on the map:

```ts
  private fallbackArena(): THREE.Group {
    const root = new THREE.Group();
    const f = activeFloor();
    root.add(f.kind === 'bowl' ? this.bowlFloor() : this.flatFloor(f.outline, f.open));
    const boxMesh = …; // unchanged
    for (const w of WALLS) boxMesh(w, 0x8b98b0);
    for (const r of RIM) boxMesh(r, 0x39465e);
    // (buildings, tunnels and trees unchanged)
    BELTS.forEach(b => root.add(this.beltMesh(b)));
    SAWS.forEach(s => { const o = this.sawMesh(s); root.add(o.track); root.add(o.blade); this.sawMeshes.push(o.blade); });
    BUMPERS.forEach(b => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(HAZARD.bumperRadius, HAZARD.bumperRadius, 1, 24),
        new THREE.MeshStandardMaterial({ color: 0xff4fa0, emissive: 0xff4fa0, emissiveIntensity: 0.3, metalness: 0.3, roughness: 0.4 }));
      mesh.position.set(b.x, 0.5, b.z); mesh.castShadow = mesh.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.TorusGeometry(HAZARD.bumperRadius * 0.7, 0.12, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      cap.rotation.x = -Math.PI / 2; cap.position.y = 0.52; mesh.add(cap);
      root.add(mesh); this.bumperMeshes.push({ mesh, flash: 0 });
    });
    return root;
  }
```
  Move the existing bowl code (from `const data = bowlMesh(48, 128)` to `bowl.receiveShadow = true;`) into `private bowlFloor(): THREE.Mesh` which returns `bowl`. Add:

```ts
  /** A flat map: a slab with a checker top. An open map gets a yellow line on its edges and visible sides. */
  private flatFloor(outline: [number, number][], open: boolean): THREE.Group {
    const g = new THREE.Group(), n = outline.length;
    const cx = outline.reduce((s, p) => s + p[0], 0) / n, cz = outline.reduce((s, p) => s + p[1], 0) / n;
    const pos: number[] = [cx, 0, cz], uv: number[] = [cx / 4, cz / 4], idx: number[] = [];
    for (const [x, z] of outline) { pos.push(x, 0, z); uv.push(x / 4, z / 4); }
    for (const [x, z] of outline) { pos.push(x, -1.5, z); uv.push(x / 4, z / 4); }
    for (let i = 0; i < n; i++) {
      const a = 1 + i, b = 1 + ((i + 1) % n);
      idx.push(0, b, a, a, b, b + n, a, b + n, a + n);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#2d3a55'; ctx.fillRect(0, 0, 64, 64); ctx.fillStyle = '#27324a'; ctx.fillRect(0, 0, 32, 32); ctx.fillRect(32, 32, 32, 32);
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide }));
    floor.receiveShadow = true;
    g.add(floor);
    if (open) outline.forEach((a, i) => {
      const b = outline[(i + 1) % n]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const line = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.35), new THREE.MeshBasicMaterial({ color: 0xffc93f }));
      line.rotation.set(-Math.PI / 2, 0, -Math.atan2(b[1] - a[1], b[0] - a[0]));
      line.position.set((a[0] + b[0]) / 2, 0.02, (a[1] + b[1]) / 2);
      g.add(line);
    });
    return g;
  }

  /** A belt: moving chevrons that point the way it carries. */
  private beltMesh(b: Box): THREE.Group {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#30343c'; ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = '#ffc93f'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(18, 10); ctx.lineTo(42, 32); ctx.lineTo(18, 54); ctx.stroke();
    const tex = new THREE.CanvasTexture(c); tex.wrapS = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    tex.repeat.set((b.hx * 2) / (b.hz * 2), 1);
    this.beltTextures.push(tex);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(b.hx * 2, b.hz * 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    plane.rotation.x = -Math.PI / 2; plane.receiveShadow = true;
    const g = new THREE.Group();
    g.position.set(b.x, 0.03, b.z); g.rotation.y = -b.angle;
    g.add(plane);
    return g;
  }

  /** A saw: a dark slot for its track and a spinning toothed blade. */
  private sawMesh(s: Saw): { track: THREE.Mesh; blade: THREE.Group } {
    const dx = s.to[0] - s.from[0], dz = s.to[1] - s.from[1], len = Math.hypot(dx, dz);
    const track = new THREE.Mesh(new THREE.PlaneGeometry(len + HAZARD.sawRadius * 2, 0.5), new THREE.MeshBasicMaterial({ color: 0x0b0e16 }));
    track.rotation.set(-Math.PI / 2, 0, -Math.atan2(dz, dx));
    track.position.set((s.from[0] + s.to[0]) / 2, 0.025, (s.from[1] + s.to[1]) / 2);
    const blade = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9d2dc, metalness: 0.9, roughness: 0.25 });
    blade.add(new THREE.Mesh(new THREE.CylinderGeometry(HAZARD.sawRadius * 0.85, HAZARD.sawRadius * 0.85, 0.12, 32), metal));
    const teeth = new THREE.MeshStandardMaterial({ color: 0xff5a4f, metalness: 0.6, roughness: 0.3 });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2, tooth = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 4), teeth);
      tooth.position.set(Math.cos(a) * HAZARD.sawRadius * 0.9, 0, Math.sin(a) * HAZARD.sawRadius * 0.9);
      tooth.rotation.set(0, -a, -Math.PI / 2);
      blade.add(tooth);
    }
    blade.traverse(o => { o.castShadow = true; });
    return { track, blade };
  }
```
  Add `type Saw` to the imports from `../sim/maps.ts`.
- `render(frame, viewer, dt)`: before `if (frame) this.apply(…)`, animate hazards:

```ts
    for (const tex of this.beltTextures) tex.offset.x -= (dt * HAZARD.beltMechSpeed) / 2;
    const clock = frame?.view.clock ?? 0;
    this.sawMeshes.forEach((blade, i) => { const p = sawPosition(SAWS[i]!, clock); blade.position.set(p.x, 0.45, p.z); blade.rotation.y += dt * 20; });
    for (const b of this.bumperMeshes) { b.flash = Math.max(0, b.flash - dt * 4); (b.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + b.flash * 1.5; }
```
- `pick`: replace the loop's height line with `y = surfaceHeight(x, z);` (on the bowl beyond the rim it already returns the rim height).
- Fallen tops: in `apply`, `o.visible = !t.out && (this.isMine(viewer, i) || seen(t.x, t.z));`; in `updateTags`, `view.tops.forEach((t, i) => { if (t.out) return; … })`; in `updateSelf`, replace the first two lines with:

```ts
    const m = view.mech, t0 = viewer.team === 'top' ? view.tops[viewer.top] : null, t = t0 && !t0.out ? t0 : null;
    // A fallen top shows no ring (and never the mech's ring).
    const me = viewer.team === 'top' ? t : viewer.team === 'mech' ? m : null;
```
- `effect`: add

```ts
      case 'saw': this.ring(e.x, e.z, 1, 0xffa040, 0.35, 2); this.shake = Math.max(this.shake, 0.3); break;
      case 'bump': { this.ring(e.x, e.z, HAZARD.bumperRadius + 0.3, 0xff4fa0, 0.3, 1); const b = this.bumperMeshes.find(o => Math.hypot(o.mesh.position.x - e.x, o.mesh.position.z - e.z) < 0.1); if (b) b.flash = 1; break; }
      case 'respawn': { const t = view.tops[e.top]; if (t) this.ring(t.x, t.z, 1, 0xffffff, 0.5, 2); break; }
```
- Remove `ARENA` from the tuning import if it is no longer used after moving the bowl colours (it is still used in `bowlFloor` for `ARENA.floorRadius`; keep it).

- [ ] **Step 2: Hook the scene to the lobby** — `src/main.ts`, in `renderLobby` after `const me = …`: `scene.setMap(lobby.map);`. In the `'leave'` handler add `scene.setMap('city');`.

- [ ] **Step 3: Bots on the new maps** — `src/sim/bots.ts`:

```ts
import type { ArenaView, MechInput, TopInput } from './arena.ts';
import { clampInside } from './bowl.ts';
import { BUILDINGS, POSTS, pushOutOfBox, pushOutOfCircle, WALLS } from './city.ts';
import { forward } from './rules.ts';

/** A steering push away from nearby buildings, walls, trunks, bumpers and the floor's edge, so bots do not stick to them or fall. */
function avoid(x: number, z: number, range: number): [number, number] {
  let ax = 0, az = 0;
  for (const b of [...BUILDINGS, ...WALLS]) { const h = pushOutOfBox(b, x, z, range); if (h) { ax += h.nx; az += h.nz; } }
  for (const p of POSTS) { const h = pushOutOfCircle(p.x, p.z, p.r, x, z, range * 0.6); if (h) { ax += h.nx; az += h.nz; } }
  const edge = clampInside(x, z, range + 2);
  if (edge) { ax -= edge.nx * 2; az -= edge.nz * 2; }
  return [ax, az];
}
```
In `TopBot.input`, after `if (!me) …`, add `if (me.out) return { mx: 0, mz: 0, ax: 0, az: 0, dash: this.dash };`. In `MechBot.input`, skip fallen tops: `for (const t of view.tops) { if (t.out) continue; … }`.

- [ ] **Step 4: Sounds and HUD** — `src/audio.ts` switch, add:

```ts
      case 'saw': tone(1800, 600, 0.15, 'sawtooth', 0.1); break;
      case 'bump': tone(600, 1200, 0.12, 'square', 0.12); break;
      case 'fall': tone(500, 80, 0.6, 'sine', 0.14); break;
      case 'respawn': tone(300, 900, 0.2, 'triangle', 0.1); break;
```
`src/render/hud.ts` top row: `${t.out ? ' (fell)' : ''}` after the stun mark.

- [ ] **Step 5: Type check, unit tests, and look at each map**

Run: `npx tsc -b && npx vitest run`
Expected: PASS.
Then run `npm run dev`, open http://localhost:5211, click **Practice with bots**, and for each map button: click it, click **Ready**, click **Start**, and look for 10 s. Check: the floor and obstacles match the physics (the mech stops at walls and posts, not in the air), belts move in the direction they push, saw blades follow their slots, bumpers flash on a hit, a top that falls on Sawmill disappears and comes back after 3 s. Take a screenshot of each map into `e2e/out/`.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "Draw the new maps: flat floors, rims, belts, saws, bumpers; bots avoid edges"
```

---

### Task 8: End-to-end checks and README

**Files:**
- Modify: `e2e/lobby.mjs`, `e2e/practice.mjs`, `e2e/touch.mjs`, `e2e/keyboard2.mjs`, `README.md`

- [ ] **Step 1: `e2e/practice.mjs`** — after `await page.click('#practice');` add `await page.click('#ready');`. Move the final `check('no page errors', …)` and the error print below a new loop that plays the other maps (place the loop after the `check('bot dashes create shadows', …)` line):

```js
for (const map of ['yard', 'sawmill', 'bumpers']) {
  await page.evaluate(() => { window.spinArena.session.arena.mech.status.health = 0; });
  await page.waitForSelector('#again:not(.hidden)');
  await page.click('#again');
  await page.click(`[data-map="${map}"]`);
  await page.click('#ready');
  await page.click('#start');
  await page.waitForTimeout(6000);
  const s = await state();
  check(`${map}: the round runs on the chosen map`, (s.phase === 'playing' && s.clock > 2) || s.phase === 'over');
  check(`${map}: the scene shows the chosen map`, await page.evaluate(m => window.spinArena.scene.mapId === m, map));
  await page.screenshot({ path: `${OUT}/practice-${map}.png` });
}
```

- [ ] **Step 2: `e2e/lobby.mjs`** — replace `await host.click('#start');` with:

```js
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
```
and after `check('host returns everyone to the lobby', true);` add:

```js
  check('ready resets after a round', await host.evaluate(() => window.spinArena.session.lobby.players.every(p => !p.ready)));
```
Also update the scores check to the per-map list: `const scores = await kids[0].evaluate(() => window.spinArena.session.lobby.scores.city);`.

- [ ] **Step 3: `e2e/touch.mjs`** — before each `await tap('#start');` (two places) add `await tap('#ready');`.

- [ ] **Step 4: `e2e/keyboard2.mjs`** — before the first `await host.click('#start');` add `await host.click('#ready');`; before `await h.click('#start');` add `await h.click('#ready'); await g.click('#ready'); await h.waitForFunction(() => !document.querySelector('#start').disabled, null, { timeout: 30000 });`.

- [ ] **Step 5: README** — update:
  - **Play** steps: step 3 "In the lobby, each player picks **Play the mech**, **Play a top**, or **Watch**, and can change their name." New step 4 "The host picks the map. Each player clicks **Ready**." Step 5 "The host clicks **Start** when everyone is ready and there is one mech and one to four tops."
  - Best times: "The 10 best times for each map are kept on the host's computer and shown to everyone."
  - New section **Maps** after **Rules**:

```md
## Maps

| Map | What is special |
| --- | --- |
| City Bowl | The oval city bowl: buildings, half walls, tunnels and trees (`src/arena-layout.json`). |
| Conveyor Yard | Belts carry tops up to 18 m/s along them (normal top speed is 11 m/s) and move the mech 5 m/s faster. |
| Sawmill | Open edges: a top that falls is out for 3 s, then respawns at the spawn farthest from the mech. Two saw blades throw tops and push the mech (no damage). The mech and the shadows cannot fall. |
| Bumper Park | Pinball bumpers kick tops away at 24 m/s or more. Shadows bounce off them; they block the walking mech. |

Map definitions are in `src/sim/maps.ts`.
```
  - **Code** table: add `| src/sim/maps.ts | Map definitions: floor, obstacles, spawns, belts, saws, bumpers |` and change the `city.ts` row to "Obstacles of the active map (`setMap`), belts, saws and bumpers".

- [ ] **Step 6: Run everything**

Run: `npx vitest run && npm run build`
Then, with `npm run dev` running in another shell:
Run: `node e2e/practice.mjs && node e2e/touch.mjs && node e2e/keyboard2.mjs && node e2e/lobby.mjs`
Expected: every line `PASS`, exit code 0. (`lobby.mjs` and `keyboard2.mjs` need internet for the PeerJS broker.)
Look at `e2e/out/practice-*.png` to confirm each map renders.

- [ ] **Step 7: Commit**

```bash
git add e2e README.md
git commit -m "e2e: ready, names and maps; README: maps and the new lobby"
```
