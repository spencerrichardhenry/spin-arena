# Spin Arena

An asymmetric browser party game. One player drives a mech. One to four players are spinning tops.
The mech cannot win: the score is how long it survives. Every dash leaves a shadow top that never
stops, so each round becomes impossible over time.

## Play

```bash
npm install
npm run dev        # http://localhost:5211
```

1. One player clicks **Create room** and shares the code (or **Copy link**).
2. The other players enter the code and click **Join**.
3. In the lobby, each player picks **Play the mech**, **Play a top**, or **Watch**.
4. The host clicks **Start** when there is one mech and one to four tops.

**Practice with bots** starts a local round with no network. The host can add bot tops or a bot mech in any lobby.
Rounds with bots are not recorded. The 10 best times are kept on the host's computer and shown to everyone.

Keep the host's page open for the whole round. If the host closes it, the round ends for everyone.

## Phones (Android)

The game has touch controls: drag anywhere on the left half of the screen to move; the buttons at the
bottom right are **Dash** (tops) or the three mech abilities. Abilities aim where you move.
Phones and computers play together in the same room.

```bash
npm run android:install   # builds artifacts/Spin-Arena-debug.apk and installs it on the connected phone
```

The build uses the Android SDK in `../.android-sdk` or `~/Library/Android/sdk`, and Java 21.
Phones can also open the web version: https://spencerrichardhenry.github.io/spin-arena/

## Controls

| Role | Input | Action |
| --- | --- | --- |
| Top | WASD | Move |
| Top | Q or left click | Dash toward the mouse. Cooldown: 5.5 s × the number of tops (11 s with 2 tops) |
| Mech | WASD / mouse | Move / face the mouse (the mech turns at a limited rate) |
| Mech | Shift | Legs ability: **Boost** (burst of speed) or **Blink** (teleport toward the mouse) |
| Mech | Space | Back ability: **Jump** to the mouse, or hold for **Hover** (fly low for 2.5 s) |
| Mech | Right click or E | Arms ability: **Parry** (pulse that deletes shadows and throws tops) or **Shield** (3 s of front armour) |

Pick one option for each mech slot in the lobby. The choice changes the mech's parts.
Tops pick a cap, a ring and a tip (four designs each). This is only cosmetic; the ring sets the colour.

## Rules

- The arena is a large oval city bowl (`src/arena-layout.json`). The camera follows your own character.
  - **Buildings** block everything. A jump or blink stops in front of them.
  - **Half walls** block tops, shadows and the walking mech. The mech can jump or hover over them.
  - **Tunnels**: tops roll through the passage, or over the roof with speed. The mech walks over them.
  - **Trees**: the trunk blocks; the canopy hides whoever is behind it.
  - A player under a tunnel roof or behind a canopy is hidden from the other players, name tag included.
    Your own character stays visible to you: the roof, canopy or building in front of you becomes see-through.
- Three seconds after each dash, a **shadow** replays that dash from the same start point and direction.
  Shadows keep their speed, bounce around the bowl, and stay until the round ends.
- The mech has **12 health** and four sides. The side is set by where a top strikes it.
  Each side has three orange plates. **Three hits break a side** and its power:
  front = parry, rear = jump, left and right legs = speed and boost. Hits on a broken side still cost health.
- A top must hit at speed to do damage. After a hit, the mech ignores top hits for 0.75 s.
- **Shadows do no damage.** Each shadow hit adds a slow (10 % for 4 s). A shadow hit also knocks the mech back
  and removes control for 0.4 s, then gives 2 s of knock-back immunity. Slows still stack during that time.

All numbers are in `src/tuning.ts`.

## Code

| Path | Purpose |
| --- | --- |
| `src/sim/rules.ts` | Mech rules without engine code: sections, damage, slows, powers, scores |
| `src/sim/arena.ts` | Rapier world: bowl, tops, shadows, mech, hits, parry, jump |
| `src/sim/bowl.ts` | Bowl profile, shared by physics, rendering and Blender |
| `src/sim/city.ts` | Buildings, walls, tunnels and trees from `src/arena-layout.json` |
| `src/sim/bots.ts` | Practice bots |
| `src/net/` | Message checks, room codes, PeerJS room (adapted from Wildtag's Grandpa visit) |
| `src/session.ts` | Host (runs the simulation, 20 Hz snapshots) and guest (interpolation) |
| `src/render/` | three.js scene, model loading with built-in fallbacks, HUD |

## Tests

```bash
npm test                               # rules, Rapier simulation, protocol, 500-shadow timing
npm run dev &                          # then, in another shell:
node e2e/practice.mjs                  # practice round in headless Chromium
node e2e/lobby.mjs                     # host + two guests through the PeerJS broker (needs internet)
python3 scripts/blender/check_assets.py
```

## Blender models

All models are built with Blender MCP from scripts in `scripts/blender`. The editable scenes are in
`art/spin-arena.blend`, and review renders are in `art/renders`.

1. Start Blender with the MCP add-on server: `/Applications/Blender.app/Contents/MacOS/Blender --python scripts/blender/start_mcp.py`
2. Build a model: `python3 scripts/blender/mcp_run.py scripts/blender/build_mech.py` (also `build_tops.py`, `build_arena.py`).
3. Check the exports: `python3 scripts/blender/check_assets.py`

`.mcp.json` also registers the Blender MCP server for Claude Code sessions in this directory.
The model contract (node names and axes) is at the top of `src/render/models.ts`.
