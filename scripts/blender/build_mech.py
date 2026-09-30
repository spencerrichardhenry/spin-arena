"""The Bulwark mech: a stocky two-legged walker with 12 removable armour plates.

Run: python3 scripts/blender/mcp_run.py scripts/blender/build_mech.py
Output: public/models/mech.glb, art/renders/mech.png, art/renders/mech_back.png
Contract (see src/render/models.ts): origin at the feet; forward is Blender -Y (game +Z);
`legL` on +X and `legR` on -X pivot at the hips about X; `thrusters` and `arms` nodes;
plates `plate_<front|rear|left|right>_<1..3>`, where plate 1 falls off first.
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

# ---- Arms: shoulder pods ending in parry emitters.
arms = C.empty('arms', (0, 0, 2.1), body)
for side in (1, -1):
    s = 'L' if side > 0 else 'R'
    C.sphere(f'Shoulder {s}', 0.3, DARK, arms, (side * 1.08, 0, 0.05))
    C.box(f'Arm {s}', (0.42, 1.25, 0.42), HULL, arms, (side * 1.22, -0.42, -0.05), bevel=0.07)
    C.cylinder(f'Emitter {s}', 0.26, 0.3, 0.14, TRIM, arms, (side * 1.22, -1.08, -0.05), rot=(math.pi / 2, 0, 0))
    C.cylinder(f'Emitter Glow {s}', 0.18, 0.18, 0.16, GLOW, arms, (side * 1.22, -1.1, -0.05), rot=(math.pi / 2, 0, 0))

# ---- Thrusters on the back; the game adds flames at local (±0.5, -0.9) along its own down axis.
thrusters = C.empty('thrusters', (0, 0.9, 1.95), body)
for side in (1, -1):
    C.cylinder(f'Nozzle {side}', 0.2, 0.26, 0.8, DARK, thrusters, (side * 0.5, 0.05, 0))
    C.cylinder(f'Nozzle Glow {side}', 0.16, 0.16, 0.05, HEAT, thrusters, (side * 0.5, 0.05, -0.4))
    C.box(f'Nozzle Clamp {side}', (0.5, 0.18, 0.12), TRIM, thrusters, (side * 0.5, -0.1, 0.25))

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
C.studio_render(scene, 'mech.png', target=(0, 0, 1.6), distance=7.0, height=2.2, azimuth=-35, lens=50)
cam = scene.camera
cam.location = (5.0, 5.0, 3.8)
scene.render.filepath = str(C.RENDERS / 'mech_back.png')
import bpy
bpy.ops.render.render(write_still=True, scene=scene.name)
C.save_blend()
print('mech exported')
