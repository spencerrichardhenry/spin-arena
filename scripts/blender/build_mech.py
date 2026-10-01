"""The Vanguard: a tall, heroic armoured mech (an original design in the style of classic mecha anime).

Run: python3 scripts/blender/mcp_run.py scripts/blender/build_mech.py
Output: public/models/mech.glb, art/renders/mech.png, mech_back.png, mech_alt.png, mech_alt_back.png, mech_third.png
Contract (see src/render/models.ts): origin at the feet, about 4.6 m tall; forward is Blender -Y (game +Z);
`legL` on +X and `legR` on -X pivot at the hips about X; `arms`; `thrusters` (the game adds jump flames at
local (±0.5, -0.9) along its own down axis); 12 white armour plates `plate_<front|rear|left|right>_<1..3>`
(plate 1 falls off first; the dark frame shows where a plate is gone); kit groups
`kit_boost|blink|phase` (legs slot), `kit_jump|hover|cloak` (back slot), `kit_parry|shield|lock` (arms slot).
"""
import importlib.util, math, pathlib
spec = importlib.util.spec_from_file_location('spin_common', pathlib.Path(__file__).with_name('common.py'))
C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)
import bpy

# The earlier Bulwark mech scene would keep the contract names (Blender names must be unique), so remove it.
old = bpy.data.scenes.get('Bulwark Mech')
if old:
    for obj in list(old.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(old)
scene = C.new_scene('Vanguard Mech')
WHITE = C.mat('Vanguard Armour', '#e8ecf1', metallic=0.25, roughness=0.32)
FRAME = C.mat('Vanguard Frame', '#232b3d', metallic=0.6, roughness=0.42)
NAVY = C.mat('Vanguard Navy', '#2f4a8a', metallic=0.4, roughness=0.35)
RED = C.mat('Vanguard Crimson', '#c3263a', metallic=0.3, roughness=0.35)
GOLD = C.mat('Vanguard Gold', '#f0b531', metallic=0.85, roughness=0.25)
STEEL = C.mat('Vanguard Steel', '#9aa3b2', metallic=1.0, roughness=0.3)
GLOW = C.mat('Vanguard Eyes', '#7cf4ff', roughness=0.2, emission='#55e8ff', strength=6)
HEAT = C.mat('Vanguard Thruster', '#ff9a3c', roughness=0.3, emission='#ff7a1a', strength=4)
VOID = C.mat('Vanguard Blink', '#b58cff', roughness=0.2, emission='#9a5cff', strength=4)
PHASE = C.mat('Vanguard Phase', '#7fffd4', roughness=0.2, emission='#3fffc0', strength=4)
STEALTH = C.mat('Vanguard Stealth', '#141821', metallic=0.7, roughness=0.5)
STEALTH_LINE = C.mat('Vanguard Stealth Line', '#8a7dff', roughness=0.3, emission='#6a5cff', strength=3)
ICE = C.mat('Vanguard Lock', '#bfefff', roughness=0.15, emission='#4fbfff', strength=4)

# Proportions: long legs, a narrow waist, a broad V-shaped chest and a small head read as a heroic mech.
HIP = 2.45
root = C.empty('mech')
body = C.empty('body', parent=root)

# ---- Legs: long, armoured, with pointed knees, flared calves and pointed feet.
legs = {}
for name, side in (('legL', 1), ('legR', -1)):
    leg = C.empty(name, (side * 0.36, 0, HIP), root)
    legs[name] = leg
    C.sphere(f'{name} Hip Joint', 0.2, FRAME, leg)
    C.frustum(f'{name} Thigh', (0.34, 0.4), (0.42, 0.46), 0.86, FRAME, leg, (0, 0, -0.92))
    C.frustum(f'{name} Knee', (0.44, 0.34), (0.3, 0.1), 0.38, WHITE, leg, (0, -0.2, -1.16), rot=(0.25, 0, 0))
    C.frustum(f'{name} Shin', (0.56, 0.62), (0.4, 0.46), 1.06, WHITE, leg, (0, 0.02, -2.14))
    C.box(f'{name} Shin Stripe', (0.08, 0.04, 0.7), RED, leg, (0, -0.3, -1.68), bevel=0.01)
    C.frustum(f'{name} Calf Vent', (0.32, 0.08), (0.24, 0.06), 0.56, FRAME, leg, (0, 0.33, -1.98))
    C.frustum(f'{name} Foot', (0.44, 0.9), (0.32, 0.5), 0.28, WHITE, leg, (0, -0.1, -HIP), shift=(0, 0.08))
    C.frustum(f'{name} Toe', (0.4, 0.24), (0.2, 0.1), 0.16, RED, leg, (0, -0.58, -HIP), shift=(0, 0.04))
    C.box(f'{name} Heel', (0.28, 0.2, 0.22), FRAME, leg, (0, 0.38, -HIP + 0.11), bevel=0.04)

# ---- Waist: a narrow pelvis, front and side skirt armour.
C.frustum('Pelvis', (0.5, 0.46), (0.76, 0.56), 0.36, FRAME, body, (0, 0, HIP - 0.12))
C.frustum('Crotch V', (0.1, 0.2), (0.32, 0.24), 0.3, RED, body, (0, -0.27, HIP - 0.15))
C.frustum('Front Skirt R', (0.32, 0.08), (0.38, 0.08), 0.5, WHITE, body, (-0.21, -0.33, HIP - 0.56), rot=(0.22, 0, 0))
for side in (1, -1):
    C.frustum(f'Side Skirt {side}', (0.1, 0.5), (0.1, 0.44), 0.52, WHITE, body, (side * 0.48, 0, HIP - 0.34), rot=(0, side * -0.22, 0))

# ---- Torso: crimson abdomen, a broad V-shaped navy chest with gold vents, a white collar.
C.frustum('Abdomen', (0.48, 0.42), (0.56, 0.46), 0.3, RED, body, (0, 0, HIP + 0.24))
C.frustum('Chest', (0.82, 0.66), (1.52, 0.86), 0.88, NAVY, body, (0, 0, HIP + 0.52), shift=(0, -0.03))
C.frustum('Collar', (1.12, 0.7), (0.78, 0.54), 0.16, WHITE, body, (0, 0.0, HIP + 1.38))
for side in (1, -1):
    vent = C.empty(f'Vent {side}', (side * 0.37, -0.47, HIP + 1.12), body)
    for k in range(4):
        C.box(f'Vent Slat {side} {k}', (0.36, 0.05, 0.05), GOLD, vent, (0, 0, k * 0.075 - 0.11), bevel=0.01)
C.box('Chest Core', (0.2, 0.06, 0.14), GLOW, body, (0, -0.46, HIP + 0.84), bevel=0.02)

# ---- Head: a small white helmet, face mask, visor eyes, a big gold V-fin and a red crest.
head = C.empty('head', (0, 0, HIP + 1.56), body)
C.cylinder('Neck', 0.12, 0.14, 0.2, FRAME, head, (0, 0, -0.06))
C.frustum('Helmet', (0.36, 0.4), (0.3, 0.34), 0.32, WHITE, head, (0, 0, 0.02))
C.frustum('Face Mask', (0.14, 0.08), (0.22, 0.08), 0.15, WHITE, head, (0, -0.2, 0.01))
C.box('Chin', (0.11, 0.06, 0.07), RED, head, (0, -0.23, 0.0), bevel=0.02)
for side in (1, -1):
    C.box(f'Eye {side}', (0.11, 0.04, 0.035), GLOW, head, (side * 0.075, -0.215, 0.2), bevel=0.01, rot=(0, side * 0.2, 0))
    C.box(f'V-Fin {side}', (0.7, 0.05, 0.1), GOLD, head, (side * 0.3, -0.19, 0.5), bevel=0.02, rot=(0, side * -0.62, 0))
    C.cylinder(f'Head Vulcan {side}', 0.035, 0.035, 0.12, STEEL, head, (side * 0.17, -0.15, 0.24), rot=(math.pi / 2, 0, 0))
    C.box(f'Ear Antenna {side}', (0.06, 0.12, 0.2), WHITE, head, (side * 0.19, 0.02, 0.18), bevel=0.02)
C.box('Crest', (0.1, 0.12, 0.1), RED, head, (0, -0.19, 0.38), bevel=0.02)

# ---- Arms: pauldrons tilted up and out, dark upper arms, bulky white forearms, dark fists.
arms = C.empty('arms', (0, 0, HIP + 1.18), body)
for side in (1, -1):
    s = 'L' if side > 0 else 'R'
    C.sphere(f'Shoulder Joint {s}', 0.22, FRAME, arms, (side * 0.9, 0, 0))
    C.frustum(f'Shoulder Armour {s}', (0.5, 0.68), (0.64, 0.8), 0.5, WHITE, arms, (side * 1.04, 0, -0.26), rot=(0, side * -0.22, 0))
    C.box(f'Shoulder Trim {s}', (0.64, 0.8, 0.06), RED, arms, (side * 1.04, 0, -0.27), bevel=0.02, rot=(0, side * -0.22, 0))
    C.frustum(f'Upper Arm {s}', (0.24, 0.26), (0.3, 0.32), 0.6, FRAME, arms, (side * 1.04, 0, -1.0))
    C.frustum(f'Forearm {s}', (0.32, 0.36), (0.42, 0.46), 0.66, WHITE, arms, (side * 1.04, -0.04, -1.7))
    C.box(f'Forearm Band {s}', (0.44, 0.48, 0.06), RED, arms, (side * 1.04, -0.04, -1.24), bevel=0.02)
    C.box(f'Fist {s}', (0.26, 0.3, 0.26), FRAME, arms, (side * 1.04, -0.06, -1.88), bevel=0.06)

# ---- Backpack: a dark pack with beam-saber hilts. Back slot: jump thrusters, hover fans or a stealth mantle.
C.box('Backpack', (0.9, 0.36, 0.76), FRAME, body, (0, 0.62, HIP + 0.98), bevel=0.06)
for side in (1, -1):
    C.cylinder(f'Saber Hilt {side}', 0.05, 0.05, 0.44, WHITE, body, (side * 0.3, 0.72, HIP + 1.52), rot=(-0.35, 0, 0))
jump = C.empty('kit_jump', parent=body)
thrusters = C.empty('thrusters', (0, 0.86, HIP + 0.72), jump)
for side in (1, -1):
    C.cylinder(f'Nozzle {side}', 0.15, 0.24, 0.6, STEEL, thrusters, (side * 0.5, 0, -0.1), rot=(-0.3, 0, 0))
    C.cylinder(f'Nozzle Glow {side}', 0.13, 0.13, 0.04, HEAT, thrusters, (side * 0.5, 0.11, -0.4), rot=(-0.3, 0, 0))
    C.box(f'Nozzle Arm {side}', (0.5, 0.14, 0.12), FRAME, thrusters, (side * 0.3, -0.08, 0.22))
hover = C.empty('kit_hover', parent=body)
for side in (1, -1):
    C.cylinder(f'Fan Ring {side}', 0.42, 0.42, 0.16, FRAME, hover, (side * 0.74, 0.86, HIP + 1.0), segments=32, rot=(math.pi / 2, 0, 0))
    C.cylinder(f'Fan Glow {side}', 0.32, 0.32, 0.04, GLOW, hover, (side * 0.74, 0.93, HIP + 1.0), segments=32, rot=(math.pi / 2, 0, 0))
    for k in range(3):
        C.box(f'Fan Blade {side} {k}', (0.66, 0.03, 0.08), STEEL, hover, (side * 0.74, 0.91, HIP + 1.0), bevel=0, rot=(0, k * math.pi / 3, 0))
cloak = C.empty('kit_cloak', parent=body)
for side in (1, -1):
    C.frustum(f'Mantle {side}', (0.5, 0.08), (0.3, 0.06), 1.5, STEALTH, cloak, (side * 0.42, 0.84, HIP + 0.05), rot=(-0.12, side * 0.18, 0))
    C.box(f'Mantle Line {side}', (0.04, 0.02, 1.3), STEALTH_LINE, cloak, (side * 0.42, 0.9, HIP + 0.76), bevel=0, rot=(-0.12, side * 0.18, 0))

# ---- Legs slot on the hips: boost jets, blink coils or phase fins.
boost, blink, phase = C.empty('kit_boost', parent=body), C.empty('kit_blink', parent=body), C.empty('kit_phase', parent=body)
for side in (1, -1):
    C.cylinder(f'Hip Jet {side}', 0.12, 0.17, 0.42, STEEL, boost, (side * 0.64, 0.3, HIP - 0.24), rot=(math.pi / 2, 0, 0))
    C.cylinder(f'Hip Jet Glow {side}', 0.1, 0.1, 0.03, HEAT, boost, (side * 0.64, 0.52, HIP - 0.24), rot=(math.pi / 2, 0, 0))
    for k in range(3):
        C.cylinder(f'Coil {side} {k}', 0.15, 0.15, 0.05, VOID, blink, (side * 0.62, 0.2, HIP - 0.44 + k * 0.12), segments=16)
    for k in range(2):
        C.frustum(f'Phase Fin {side} {k}', (0.04, 0.5), (0.02, 0.1), 0.5, PHASE, phase, (side * (0.6 + k * 0.08), 0.16, HIP - 0.46 + k * 0.1), rot=(0, side * 0.5, 0))

# ---- Arms slot on the forearms: parry emitters, a shield on the left arm, or a lock rifle on the right.
parry, shield, lock = C.empty('kit_parry', parent=arms), C.empty('kit_shield', parent=arms), C.empty('kit_lock', parent=arms)
for side in (1, -1):
    C.cylinder(f'Emitter {side}', 0.2, 0.2, 0.06, STEEL, parry, (side * 1.27, -0.04, -1.42), rot=(0, math.pi / 2, 0))
    C.cylinder(f'Emitter Glow {side}', 0.14, 0.14, 0.07, GLOW, parry, (side * 1.28, -0.04, -1.42), rot=(0, math.pi / 2, 0))
C.frustum('Shield', (0.12, 0.62), (0.12, 0.4), 1.6, WHITE, shield, (1.36, -0.15, -2.35), rot=(0, 0, 0.08))
C.box('Shield Band', (0.14, 0.5, 0.18), RED, shield, (1.37, -0.15, -1.45), bevel=0.02, rot=(0, 0, 0.08))
C.box('Shield Rim', (0.13, 0.04, 1.5), GOLD, shield, (1.37, -0.46, -1.6), bevel=0.01, rot=(0, 0, 0.08))
C.box('Lock Rifle', (0.18, 1.1, 0.2), FRAME, lock, (-1.18, -0.55, -1.75), bevel=0.04)
C.cylinder('Lock Barrel', 0.07, 0.07, 0.5, STEEL, lock, (-1.18, -1.3, -1.72), rot=(math.pi / 2, 0, 0))
C.sphere('Lock Lens', 0.09, ICE, lock, (-1.18, -1.56, -1.72))

# ---- Armour plates (white over the dark frame). Plate 1 falls off first.
C.frustum('plate_front_1', (0.46, 0.08), (0.54, 0.08), 0.36, WHITE, body, (0.38, -0.46, HIP + 0.7))
C.frustum('plate_front_2', (0.46, 0.08), (0.54, 0.08), 0.36, WHITE, body, (-0.38, -0.46, HIP + 0.7))
C.frustum('plate_front_3', (0.32, 0.08), (0.38, 0.08), 0.5, WHITE, body, (0.21, -0.33, HIP - 0.56), rot=(0.22, 0, 0))
C.box('plate_rear_1', (0.8, 0.08, 0.3), WHITE, body, (0, 0.82, HIP + 1.2), bevel=0.03)
C.box('plate_rear_2', (0.36, 0.08, 0.34), WHITE, body, (0.22, 0.82, HIP + 0.86), bevel=0.03)
C.box('plate_rear_3', (0.36, 0.08, 0.34), WHITE, body, (-0.22, 0.82, HIP + 0.86), bevel=0.03)
for name, section, side in (('legL', 'left', 1), ('legR', 'right', -1)):
    C.box(f'plate_{section}_1', (0.68, 0.82, 0.12), WHITE, arms, (side * 1.1, 0, 0.27), bevel=0.04, rot=(0, side * -0.22, 0))
    C.box(f'plate_{section}_2', (0.1, 0.4, 0.6), WHITE, legs[name], (side * 0.24, -0.02, -0.5), bevel=0.03)
    C.box(f'plate_{section}_3', (0.1, 0.46, 0.66), WHITE, legs[name], (side * 0.3, 0, -1.65), bevel=0.03)

C.export(scene, 'mech.glb', [root])


def show_kit(names):
    for kit in ('boost', 'blink', 'phase', 'jump', 'hover', 'cloak', 'parry', 'shield', 'lock'):
        node = bpy.data.objects[f'kit_{kit}']
        for o in [node, *node.children_recursive]:
            o.hide_render = kit not in names


def render(name, location):
    scene.camera.location = location
    scene.render.filepath = str(C.RENDERS / name)
    bpy.ops.render.render(write_still=True, scene=scene.name)


# Review renders of the three kits, front and back.
show_kit({'boost', 'jump', 'parry'})
C.studio_render(scene, 'mech.png', target=(0, 0, 2.4), distance=9, height=1.4, azimuth=-30, lens=50)
render('mech_back.png', (5.5, 6.5, 4.0))
show_kit({'blink', 'hover', 'shield'})
render('mech_alt.png', (-4.2, -7.5, 3.6))
render('mech_alt_back.png', (5.5, 6.5, 4.0))
show_kit({'phase', 'cloak', 'lock'})
render('mech_third.png', (4.6, -7.2, 3.6))
show_kit({'boost', 'blink', 'phase', 'jump', 'hover', 'cloak', 'parry', 'shield', 'lock'})
C.save_blend()
print('mech exported')
