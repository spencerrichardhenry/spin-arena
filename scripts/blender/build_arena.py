"""The stadium bowl. Its surface uses the same profile as the physics (src/sim/bowl.ts), read from src/tuning.ts.

Run: python3 scripts/blender/mcp_run.py scripts/blender/build_arena.py
Output: public/models/arena.glb, art/renders/arena.png
"""
import importlib.util, math, pathlib
spec = importlib.util.spec_from_file_location('spin_common', pathlib.Path(__file__).with_name('common.py'))
C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)

A = C.tuning('ARENA')
FLOOR, RIM, RIM_H, CURVE = A['floorRadius'], A['rimRadius'], A['rimHeight'], A['floorCurve']


def bowl_height(r):  # keep identical to bowlHeight in src/sim/bowl.ts
    floor = CURVE * min(r, FLOOR) ** 2
    if r <= FLOOR:
        return floor
    t = min(1.0, (r - FLOOR) / (RIM - FLOOR))
    return floor + (RIM_H - floor) * (1 - math.sqrt(1 - t * t))


def band(name, r0, r1, material, steps=6, lift=0.0):
    pts = [(r0 + (r1 - r0) * i / steps, 0) for i in range(steps + 1)]
    if r1 > FLOOR:  # sample the steep rim more densely toward its top
        pts = [(r0 + (r1 - r0) * math.sin(i / (steps * 3) * math.pi / 2), 0) for i in range(steps * 3 + 1)]
    return C.lathe(name, [(max(r, 0.001), bowl_height(r) + lift) for r, _ in pts], material, root, segments=128)


def double_sided(*materials):
    for m in materials:
        m.use_backface_culling = False


scene = C.new_scene('Stadium')
root = C.empty('arena')
DEEP = C.mat('Bowl Deep', '#1e2a44', metallic=0.15, roughness=0.5)
MID = C.mat('Bowl Mid', '#26365a', metallic=0.15, roughness=0.5)
RIMM = C.mat('Bowl Rim', '#3c4d72', metallic=0.3, roughness=0.4)
LINE = C.mat('Bowl Line', '#ff8a3d', roughness=0.35, emission='#ff7a1a', strength=1.6)
CYAN = C.mat('Bowl Cyan', '#5fe3ff', roughness=0.3, emission='#5fe3ff', strength=2.0)
STEEL = C.mat('Stadium Steel', '#cfd7e2', metallic=1.0, roughness=0.25)
FRAME = C.mat('Stadium Frame', '#161c2a', metallic=0.4, roughness=0.6)
double_sided(DEEP, MID, RIMM, LINE, CYAN)

# Floor bands alternate every 3 m, so the slope reads from the top-down camera.
edges = [0, 1.3, 3, 6, 9, 12, FLOOR - 0.12]
for i in range(len(edges) - 1):
    band(f'Floor {i}', edges[i], edges[i + 1], DEEP if i % 2 else MID)
band('Floor Line', FLOOR - 0.12, FLOOR + 0.12, LINE, steps=1)
band('Rim', FLOOR + 0.12, RIM, RIMM, steps=10)
# Centre emblem: a ring and a disc, slightly above the surface.
band('Centre Ring', 1.3, 1.45, CYAN, steps=1, lift=0.01)
C.polar_prism('Centre Star', lambda a: 0.5 + 0.6 * (1 - abs(((a * 4 / math.tau) % 1) - 0.5) * 2) ** 3, 0.0, 0.03, LINE, root, samples=160, bevel=0)
# Tick marks on the rim every 30°, so players can judge angles.
for k in range(12):
    a = k / 12 * math.tau
    r = FLOOR + 2.4
    C.box(f'Tick {k}', (0.7, 0.12, 0.05), CYAN, root, (math.cos(a) * r, math.sin(a) * r, bowl_height(r) + 0.04), bevel=0.02, rot=(0, -math.atan2(bowl_height(r + 0.3) - bowl_height(r - 0.3), 0.6), a))

# Rim lip, outer skirt and support pillars.
lip = C.lathe('Lip', [(RIM - 0.1, RIM_H - 0.1), (RIM + 0.25, RIM_H + 0.2), (RIM + 0.6, RIM_H + 0.25), (RIM + 0.8, RIM_H), (RIM + 0.7, RIM_H - 0.3)], STEEL, root, segments=128)
C.lathe('Skirt', [(RIM + 0.7, RIM_H - 0.3), (RIM + 2.2, RIM_H - 1.4), (RIM + 3.0, -1.5), (RIM + 3.2, -3)], FRAME, root, segments=64)
for k in range(8):
    a = (k + 0.5) / 8 * math.tau
    r = RIM + 2.1
    C.box(f'Pillar {k}', (0.8, 1.2, RIM_H + 2.5), STEEL, root, (math.cos(a) * r, math.sin(a) * r, (RIM_H - 3) / 2 + 0.2), bevel=0.08, rot=(0, 0, a))
    C.box(f'Pillar Light {k}', (0.84, 0.3, 0.3), CYAN, root, (math.cos(a) * r, math.sin(a) * r, RIM_H - 0.5), bevel=0.05, rot=(0, 0, a))

C.export(scene, 'arena.glb', [root])
C.studio_render(scene, 'arena.png', target=(0, 0, 0), distance=34, height=26, azimuth=0, lens=40, size=(1200, 800))
C.save_blend()
print('arena exported')
