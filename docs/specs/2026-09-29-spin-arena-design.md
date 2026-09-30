# Spin Arena design (2026-09-29)

Asymmetric browser party game. One adult plays a mech; one to four children play spinning tops.
The mech has no win condition: the score is how long it survives. Multiplayer follows Wildtag's
Grandpa visit (PeerJS room code, the host's browser runs the simulation), extended to four guests.

## Rules
- Lobby: anyone creates a room; every player picks Mech, Top, or Watch. Start needs one mech and 1–4 tops.
  The host can add practice bots; runs with bots are not recorded.
- Tops: WASD move, Q (or click) dashes toward the mouse for 0.8 s, cooldown 5 s. Spin is animation only.
- Shadows: 3 s after each dash, a shadow replays it from the dash start point in the dash direction.
  Shadows keep a constant speed, ride the rim, and stay for the whole round. No maximum.
- Mech: 12 health, four 90° sections (front/parry, rear/jump, left and right legs/speed and boost),
  three plates each. Three hits break a section and its power; hits on a broken section still cost health.
  0.75 s top-hit immunity. A hit needs a closing speed of at least 4 m/s.
- Shadow hits: always a slow stack (10 % for 4 s, minimum 25 % speed); a push with 0.4 s control loss,
  then 2 s push immunity.
- Mech powers: Shift boost, Space jump to the mouse (airborne = no collisions), right click / E parry pulse
  (flings tops and shadows, no hits during 0.35 s).
- High scores: best 10 on the host device, shared with every player.

## Architecture
Vite + TypeScript + three.js + Rapier + PeerJS. `src/sim` (rules without engine code, Rapier arena, bots),
`src/net` (protocol, room), `src/render` (scene, models, HUD), `src/session.ts` (host/guest), `src/main.ts`.
All tuning numbers are in `src/tuning.ts`. The host simulates at 60 Hz from a worker timer and sends
snapshots at 20 Hz; shadows are packed as 16-bit integers. Guests render 100 ms late with interpolation.

## Assets
Blender MCP scripts in `scripts/blender`, sources in `art/`, GLBs in `public/models`. Model contract is in
`src/render/models.ts`. Every model has a built-in fallback shape.

## Changes after the first playtest (2026-09-29)
- The bowl is an oval, 1.45 times wider along x. Six half walls from `src/arena-layout.json`: tops and shadows
  bounce off them; the mech is blocked on the ground and can jump over them. A dash ends when it is blocked.
- Dash cooldown: 5.5 s multiplied by the number of tops in the round (bots count).
- Parry: deletes every shadow in the pulse and every shadow that touches the mech during it; throws tops at
  44 m/s and ignores their movement input for 0.7 s, so they reach the far side.
- Menus draw at 10 frames per second; a round draws at full rate.

## Not in the first version
Speed boosts, ramps, jumps, other arenas, gamepad/touch, host migration, client prediction.
