# Ready lobby, new maps and a stronger mech (2026-10-05)

Three upgrades from the playtest feedback. The goal is more variety between rounds and a mech that survives longer.

## 1. Lobby: ready and nicknames

- `LobbyPlayer` gets `ready: boolean`. A new guest message `{ t: 'ready'; ready: boolean }` sets it.
- Each player sees a **Ready** button (a toggle). The player list shows a mark for each ready player.
- `canStart` needs one mech, one to four tops, and every player ready, watchers too. A player counts as ready when:
  - it is a bot, or
  - `ready` is true, or
  - it is a second keyboard player (id `<owner>~2`) and its owner is ready.
- A team change resets that player's `ready` to false. A name, kit, look or map change does not.
- **Back to the lobby** resets every player's `ready` to false.
- The host still clicks **Start**. While players are not ready, the status line names them: "Waiting for: Ana, Bo."
- Nicknames: a name field in the lobby. On change (blur or Enter), a guest sends `{ t: 'name'; name: string }`.
  The host applies `cleanName` and broadcasts the lobby. The name is also saved to `localStorage` as now.
- `PROTOCOL` goes from 1 to 2, because old clients do not send ready.

## 2. Maps

### Map model

- New file `src/sim/maps.ts` holds the map definitions. Each definition gives:
  - `id`, `name`, a one-line description;
  - the floor: `bowl` (the current oval bowl) or `flat` (height 0) with a convex polygon outline;
  - the edge: `rim` (a wall all around, as now) or `open` (things fall off, except where half walls stand);
  - buildings, half walls, tunnels, trees and spawn points (the city layout format), and the mech start point;
  - hazards: `belts`, `saws` and `bumpers` (each list can be empty).
- `src/sim/city.ts` keeps its exported names (`BUILDINGS`, `WALLS`, `TREES`, `TUNNELS`, `SPAWNS`, `surfaceHeight`,
  `tunnelLift`, …), but they become module live bindings (`export let`) for the active map. A new `setMap(id)`
  rebuilds them. Only one map is active in a browser tab at a time, so a module-level active map is safe.
  - The rejected option was to pass a map object to every function. It changes almost every line in arena,
    scene and bots for no gain in play.
- Boundary functions replace direct `clampOval` calls: `clampInside(x, z, inset)` keeps a point inside the floor
  outline (oval or polygon) and returns the outward normal.
- `new Arena(..., map)` calls `setMap(map)` first. Guests call `setMap` when the lobby's map changes. `Scene.setMap`
  removes the old arena meshes and builds the new ones.
- City Bowl keeps `arena.glb` from Blender. The new maps use three.js shapes made in code (no new Blender models).

### The maps

1. **City Bowl** (`city`): the current map, unchanged.
2. **Conveyor Yard** (`yard`): a flat 60 × 40 m rectangle with a rim wall. Six conveyor belts (3 m wide) in two
   loops, plus a few low buildings and half walls.
   - A top on a belt gets acceleration along the belt until its speed along the belt reaches `belt.topSpeed`
     (18 m/s, more than the normal 11 m/s maximum). Moving with a belt is fast; moving against it is slow.
   - The mech on the ground moves an extra `belt.mechSpeed` (5 m/s) along the belt. Not while airborne.
   - Shadows are not affected (they keep a constant speed and direction).
   - Belts show moving stripes in the belt direction.
3. **Sawmill** (`sawmill`): a flat 44 × 44 m square platform over empty space. The edge is open, except for half
   walls on some edge segments.
   - Two saw blades (radius 1.6 m) move back and forth along straight tracks. The position comes from the round
     clock, so every client can draw it.
   - A saw throws a top away from the blade at 30 m/s (no stun). A saw pushes the mech like a shadow hit
     (control loss and push immunity), with no damage and no slow. Saws do not touch shadows.
   - A top that leaves the platform falls. Below y = −6 it is out: it is hidden, takes no input, and after 3 s
     it respawns, still, at the spawn point farthest from the mech. Its ability presses while out are ignored.
   - The mech cannot fall: the platform edge blocks it, as the rim does on City Bowl.
   - Shadows cannot fall: the outline stops and bounces them, like a wall that is not drawn.
4. **Bumper Park** (`bumpers`): a flat octagon (radius 26 m) with a rim wall and nine round pinball bumpers
   (radius 1.4 m).
   - A top that touches a bumper leaves it at 24 m/s or more, away from the bumper centre. The bumper flashes.
   - Shadows bounce off bumpers (normal collision; they keep their speed).
   - The mech is blocked by bumpers, like by a tree trunk.

### Lobby and scores

- `Lobby.map` holds the map id. The host picks it with map buttons in the lobby; guests see the choice.
- Best times are kept per map: `Lobby.scores` becomes `Record<MapId, ScoreEntry[]>`, 10 per map. The old saved list
  moves to `city`. The lobby and the end screen show the list for the current map.
- Practice bots: the top bot also steers away from open edges on Sawmill.

## 3. Mech arms upgrades

- **Parry:** throws tops as now, and stuns them for 3.5 s (`MECH.parryStun`). A stunned top ignores movement input
  and cannot use its ability; presses during the stun are ignored. `TopView.stunned` is shown as a spinning ring of
  stars above the top and a mark in the HUD.
- **Shield:** covers all 360°, and lasts 5 s (was 3 s). Front hits still shorten it. It still deletes shadows that
  touch it and throws tops away. The shield mesh becomes a full cylinder.
- **Lock:** freezes every top on the map for 2.5 s, at any distance and direction. Cooldown goes from 9 s to 10 s.
  It starts the cooldown even when no top is affected. One `lock` event per frozen top.
- Lobby help text and the README change to match.

## 4. Bug fix: all mech abilities fire at GO

- Cause: `Controls` press counters keep counting across rounds, and a new `Arena` starts with `last` counters at 0.
  `step()` ignores input during the countdown, so at GO every counter that is not 0 looks like a new press, and
  every ability fires at once. Tops (Q) have the same bug. Presses during the countdown also fire at GO.
- Fix: while the clock is negative, `step()` copies the input counters into `mech.last` and each top's `lastDash`.
  Only presses after GO use an ability.

## Testing

- Vitest (protocol): `canStart` with ready players, bots and second keyboard players; team change resets ready;
  `name` message cleaning; score migration and per-map lists.
- Vitest (arena), per map where relevant:
  - parry stuns, and a stunned top ignores input and ability presses;
  - the shield blocks a top from behind; lock freezes far tops behind the mech;
  - a top on a belt goes faster than `TOP.maxSpeed`; the mech moves along a belt;
  - on Sawmill, a top off the edge is out and respawns after 3 s; the mech stays on the platform; shadows stay on;
  - a saw throws a top; a bumper kicks a top to at least 24 m/s;
  - every map: no spawn point or mech start inside an obstacle; the 500-shadow timing test passes.
- Vitest (arena): counters from an earlier round and presses during the countdown do not fire at GO.
- e2e: `e2e/lobby.mjs` readies all players before start and checks that Start is disabled before that.
  `e2e/practice.mjs` plays a short round on each map. A manual browser check of each map with screenshots.
