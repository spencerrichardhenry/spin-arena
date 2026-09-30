"""The Bulwark mech: a stocky two-legged walker with 12 removable armour plates.

Run: python3 scripts/blender/mcp_run.py scripts/blender/build_mech.py
Output: public/models/mech.glb, art/renders/mech.png, art/renders/mech_back.png
Contract (see src/render/models.ts): origin at the feet; forward is Blender -Y (game +Z);
`legL` on +X and `legR` on -X pivot at the hips about X; `thrusters` and `arms` nodes;
plates `plate_<front|rear|left|right>_<1..3>`, where plate 1 falls off first; kit groups
`kit_boost`/`kit_blink` (legs slot), `kit_jump`/`kit_hover` (back slot), `kit_parry`/`kit_shield` (arms slot).
"""
import importlib.util, math, pathlib
spec = importlib.util.spec_from_file_location('spin_common', pathlib.Path(__file__).with_name('common.py'))
C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)

scene = C.new_scene('Bulwark Mech')
HULL = C.mat('Mech Hull', '#566170', metallic=0.75, roughness=0.38)
DARK = C.mat('Mech Joint', '#1b2027', metallic=0.5, roughness=0.55)
PLATE = C.mat('Mech Plate', '#ef7a2a', metallic=0.35, roughness=0.35)
TRIM = C.mat('Mech Trim', '#d9dee6', metallic=0.9, roughness=0.25)
GLOW = C.mat('Mech Glow', '#62e6ff', roughness=0.2, emission='#62e6ff', strength=4)
HEAT = C.mat('Mech Heat', '#ff9a3c', roughness=0.3, emission='#ff7a1a', strength=3)
VOID = C.mat('Mech Blink', '#b58cff', roughness=0.2, emission='#9a5cff', strength=4)
SHIELD = C.mat('Mech Shield', '#7fe3ff', metallic=0.2, roughness=0.15, emission='#3fbfff', strength=1.2)

HIP = 1.35
root = C.empty('mech')

# ---- Legs: pivots at the hips, so the game swings them about X.
legs = {}
for name, side in (('legL', 1), ('legR', -1)):
    leg = C.empty(name, (side * 0.72, 0, HIP), root)
    legs[name] = leg
    C.sphere(f'{name} Hip', 0.24, DARK, leg)
    C.box(f'{name} Thigh', (0.4, 0.5, 0.62), HULL, leg, (0, 0.02, -0.33))
    C.cylinder(f'{name} Knee', 0.2, 0.2, 0.46, DARK, leg, (0, 0, -0.66), rot=(0, math.pi / 2, 0))
    C.box(f'{name} Shin', (0.44, 0.5, 0.58), HULL, leg, (0, -0.06, -0.96), bevel=0.06)
    C.cylinder(f'{name} Piston', 0.06, 0.06, 0.5, TRIM, leg, (side * -0.02, 0.28, -0.8), rot=(0.25, 0, 0))
    C.box(f'{name} Foot', (0.6, 0.95, 0.18), DARK, leg, (0, -0.12, -HIP + 0.09), bevel=0.05)
    for k, x in enumerate((-0.18, 0.18)):
        C.box(f'{name} Toe {k}', (0.16, 0.26, 0.14), TRIM, leg, (x, -0.66, -HIP + 0.08), bevel=0.04, rot=(0.2, 0, 0))

# ---- Body.
body = C.empty('body', (0, 0, 0), root)
C.box('Pelvis', (1.2, 0.8, 0.3), DARK, body, (0, 0, HIP + 0.12))
C.box('Hull', (1.9, 1.6, 1.05), HULL, body, (0, 0, 2.05), bevel=0.12)
C.box('Hull Keel', (1.5, 1.2, 0.2), DARK, body, (0, 0, 1.5), bevel=0.06)
C.sphere('Cockpit', 0.5, HULL, body, (0, -0.28, 2.62), scale=(1.1, 1.0, 0.62))
C.box('Visor', (0.72, 0.14, 0.2), GLOW, body, (0, -0.76, 2.62), bevel=0.05)
C.box('Brow', (0.9, 0.2, 0.08), TRIM, body, (0, -0.74, 2.76), bevel=0.03)
C.cylinder('Antenna', 0.025, 0.012, 0.6, TRIM, body, (-0.42, 0.25, 2.98))
C.sphere('Antenna Tip', 0.05, HEAT, body, (-0.42, 0.25, 3.28))
C.cylinder('Core', 0.2, 0.2, 0.08, GLOW, body, (0, -0.81, 2.12), rot=(math.pi / 2, 0, 0))

# ---- Arms: shoulder pods. The arms slot adds parry emitters or shield plates at their ends.
arms = C.empty('arms', (0, 0, 2.1), body)
parry, shield = C.empty('kit_parry', parent=arms), C.empty('kit_shield', parent=arms)
for side in (1, -1):
    s = 'L' if side > 0 else 'R'
    C.sphere(f'Shoulder {s}', 0.3, DARK, arms, (side * 1.08, 0, 0.05))
    C.box(f'Arm {s}', (0.42, 1.25, 0.42), HULL, arms, (side * 1.22, -0.42, -0.05), bevel=0.07)
    C.cylinder(f'Emitter {s}', 0.26, 0.3, 0.14, TRIM, parry, (side * 1.22, -1.08, -0.05), rot=(math.pi / 2, 0, 0))
    C.cylinder(f'Emitter Glow {s}', 0.18, 0.18, 0.16, GLOW, parry, (side * 1.22, -1.1, -0.05), rot=(math.pi / 2, 0, 0))
    # Tall shield plates, angled so the two form a front wedge.
    C.box(f'Shield {s}', (0.62, 0.12, 0.95), SHIELD, shield, (side * 1.3, -1.12, -0.05), bevel=0.05, rot=(0, 0, side * 0.35))
    C.box(f'Shield Rim {s}', (0.66, 0.16, 0.08), TRIM, shield, (side * 1.3, -1.12, 0.45), bevel=0.03, rot=(0, 0, side * 0.35))

# ---- Back slot: jump thrusters (the game adds flames at local (±0.5, -0.9) along its own down axis), or hover fans.
jump = C.empty('kit_jump', parent=body)
thrusters = C.empty('thrusters', (0, 0.9, 1.95), jump)
for side in (1, -1):
    C.cylinder(f'Nozzle {side}', 0.2, 0.26, 0.8, DARK, thrusters, (side * 0.5, 0.05, 0))
    C.cylinder(f'Nozzle Glow {side}', 0.16, 0.16, 0.05, HEAT, thrusters, (side * 0.5, 0.05, -0.4))
    C.box(f'Nozzle Clamp {side}', (0.5, 0.18, 0.12), TRIM, thrusters, (side * 0.5, -0.1, 0.25))
hover = C.empty('kit_hover', parent=body)
for side in (1, -1):
    C.cylinder(f'Fan Duct {side}', 0.46, 0.46, 0.22, DARK, hover, (side * 0.62, 1.0, 2.2), segments=32)
    C.cylinder(f'Fan Glow {side}', 0.36, 0.36, 0.05, GLOW, hover, (side * 0.62, 1.0, 2.08), segments=32)
    for k in range(3):
        C.box(f'Fan Blade {side} {k}', (0.7, 0.08, 0.03), TRIM, hover, (side * 0.62, 1.0, 2.24), bevel=0, rot=(0, 0, k * math.pi / 3))
    C.box(f'Fan Strut {side}', (0.12, 0.35, 0.12), TRIM, hover, (side * 0.62, 0.78, 2.2))

# ---- Legs slot: boost jets on the hips, or blink coils.
boost, blink = C.empty('kit_boost', parent=body), C.empty('kit_blink', parent=body)
for side in (1, -1):
    C.cylinder(f'Hip Jet {side}', 0.14, 0.2, 0.55, DARK, boost, (side * 1.02, 0.35, 1.45), rot=(math.pi / 2, 0, 0))
    C.cylinder(f'Hip Jet Glow {side}', 0.12, 0.12, 0.04, HEAT, boost, (side * 1.02, 0.63, 1.45), rot=(math.pi / 2, 0, 0))
    for k in range(3):
        C.cylinder(f'Coil {side} {k}', 0.2, 0.2, 0.06, VOID, blink, (side * 1.02, 0.3, 1.3 + k * 0.14), segments=16)
    C.sphere(f'Coil Core {side}', 0.09, VOID, blink, (side * 1.02, 0.3, 1.72))

# ---- Armour plates. Plate 1 falls off first, so it is the most exposed one.
for i, x in enumerate((0.0, -0.58, 0.58)):
    C.box(f'plate_front_{i + 1}', (0.52, 0.1, 0.46), PLATE, body, (x, -0.84, 1.85), bevel=0.04)
for i, x in enumerate((0.0, -0.6, 0.6)):
    C.box(f'plate_rear_{i + 1}', (0.5 if i == 0 else 0.44, 0.1, 0.36), PLATE, body, (x, 0.84, 2.38), bevel=0.04)
for name, section, side in (('legL', 'left', 1), ('legR', 'right', -1)):
    C.box(f'plate_{section}_1', (0.1, 0.9, 0.62), PLATE, body, (side * 0.99, -0.05, 2.05), bevel=0.04)
    C.box(f'plate_{section}_2', (0.1, 0.46, 0.5), PLATE, legs[name], (side * 0.25, 0.02, -0.33), bevel=0.03)
    C.box(f'plate_{section}_3', (0.1, 0.46, 0.44), PLATE, legs[name], (side * 0.27, -0.06, -0.96), bevel=0.03)

C.export(scene, 'mech.glb', [root])
import bpy


def show_kit(names):
    for kit in ('boost', 'blink', 'jump', 'hover', 'parry', 'shield'):
        node = bpy.data.objects[f'kit_{kit}']
        for o in [node, *node.children_recursive]:
            o.hide_render = kit not in names


# Review renders of both kits: the default one and the alternatives.
show_kit({'boost', 'jump', 'parry'})
C.studio_render(scene, 'mech.png', target=(0, 0, 1.6), distance=7.0, height=2.2, azimuth=-35, lens=50)
cam = scene.camera
cam.location = (5.0, 5.0, 3.8)
scene.render.filepath = str(C.RENDERS / 'mech_back.png')
bpy.ops.render.render(write_still=True, scene=scene.name)
show_kit({'blink', 'hover', 'shield'})
scene.render.filepath = str(C.RENDERS / 'mech_alt_back.png')
bpy.ops.render.render(write_still=True, scene=scene.name)
cam.location = (-4.0, -5.7, 3.8)
scene.render.filepath = str(C.RENDERS / 'mech_alt.png')
bpy.ops.render.render(write_still=True, scene=scene.name)
show_kit({'boost', 'blink', 'jump', 'hover', 'parry', 'shield'})
C.save_blend()
print('mech exported')
