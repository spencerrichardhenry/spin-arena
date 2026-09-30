"""Four original spinning-top designs, built through Blender MCP.

Run: python3 scripts/blender/mcp_run.py scripts/blender/build_tops.py
Output: public/models/top_0.glb … top_3.glb, art/renders/tops.png
Contract: parts `cap_<n>`, `ring_<n>` and `tip_<n>` (any cap, ring and tip fit together); the tip touches y = 0;
radius ≈ physics radius (TOP.radius). The game builds the spinning group itself.
"""
import importlib.util, math, pathlib, sys
spec = importlib.util.spec_from_file_location('spin_common', pathlib.Path(__file__).with_name('common.py'))
C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)

R = C.tuning('TOP')['radius']  # 0.6
scene = C.new_scene('Spin Tops')

METAL = C.mat('Top Metal', '#c9d3de', metallic=1.0, roughness=0.22)
DARK = C.mat('Top Dark', '#1c2129', metallic=0.2, roughness=0.55)
TIP = C.mat('Top Tip', '#e8edf2', metallic=1.0, roughness=0.12)
RUBBER = C.mat('Top Rubber', '#2a2d33', roughness=0.85)
TIPS = [
    [(0.001, 0.0), (0.03, 0.03), (0.08, 0.1), (0.15, 0.18), (0.2, 0.25), (0.21, 0.27)],             # sharp spike
    [(0.001, 0.0), (0.12, 0.0), (0.14, 0.03), (0.16, 0.12), (0.2, 0.24), (0.21, 0.27)],             # flat disc
    [(0.001, 0.0), (0.07, 0.02), (0.1, 0.07), (0.1, 0.12), (0.17, 0.2), (0.21, 0.27)],              # ball
    [(0.001, 0.0), (0.18, 0.0), (0.22, 0.03), (0.22, 0.09), (0.19, 0.16), (0.21, 0.27)],            # wide rubber
]


def saw(p):
    return p ** 1.4 if p < 0.82 else (1 - p) / 0.18 * 0.82 ** 1.4


DESIGNS = [
    # name, paint, glow, attack-ring outline, blade outline
    ('Blaze', '#ff4a3a', '#ffb37a', lambda a: R * (0.72 + 0.38 * saw((3 * a / math.tau) % 1)), lambda a: R * (0.62 + 0.3 * saw((3 * a / math.tau + 0.5) % 1))),
    ('Tidal', '#2f9dff', '#9fe0ff', lambda a: R * (0.8 + 0.28 * math.sin(math.pi * ((4 * a / math.tau) % 1) ** 0.6) ** 2), lambda a: R * (0.68 + 0.18 * math.sin(math.pi * ((4 * a / math.tau + 0.5) % 1) ** 0.6) ** 3)),
    ('Gale', '#3ed46b', '#c4ffb0', lambda a: R * (0.78 + 0.32 * max(0.0, math.cos(6 * a)) ** 6), lambda a: R * (0.66 + 0.12 * (0.5 + 0.5 * math.cos(12 * a)))),
    ('Quake', '#ffc12e', '#fff0a6', lambda a: R * (0.8 + 0.28 * (0.5 + 0.5 * math.cos(2 * a)) ** 3), lambda a: R * (0.7 + 0.2 * (0.5 + 0.5 * math.cos(2 * a + math.pi / 2)) ** 4)),
]


def star(points, outer, inner):
    def fn(a):
        p = (a * points / math.tau) % 1
        return inner + (outer - inner) * (1 - abs(p - 0.5) * 2) ** 2
    return fn


roots = []
for i, (name, paint, glow, ring_fn, blade_fn) in enumerate(DESIGNS):
    PAINT = C.mat(f'{name} Paint', paint, metallic=0.35, roughness=0.3)
    GLOW = C.mat(f'{name} Glow', glow, roughness=0.3, emission=glow, strength=2.5)
    root = C.empty(f'top_{i}')
    spin = C.empty(f'spin_{i}', parent=root)
    tip, ring, cap = C.empty(f'tip_{i}', parent=spin), C.empty(f'ring_{i}', parent=spin), C.empty(f'cap_{i}', parent=spin)
    # Tip and driver: each design has its own contact shape (sharp, flat, ball, wide rubber).
    C.lathe(f'{name} Tip', TIPS[i], TIP if i != 3 else RUBBER, tip)
    C.lathe(f'{name} Driver', [(0.21, 0.27), (0.3, 0.31), (0.34, 0.36), (0.35, 0.41), (0.001, 0.41)], DARK, tip)
    C.cylinder(f'{name} Driver Band', 0.352, 0.352, 0.03, PAINT, tip, loc=(0, 0, 0.37), segments=32)
    # Forge disc with notches, then the attack ring and the metal blades.
    C.polar_prism(f'{name} Disc', lambda a: R * (0.8 - 0.06 * (math.cos(10 * a) > 0.6)), 0.40, 0.07, METAL, ring)
    C.polar_prism(f'{name} Ring', ring_fn, 0.46, 0.15, PAINT, ring, bevel=0.02)
    C.polar_prism(f'{name} Blades', blade_fn, 0.53, 0.11, METAL, ring, bevel=0.012)
    # Energy layer dome with a glowing emblem, so the spin reads from above.
    C.lathe(f'{name} Cap', [(R * 0.55, 0.6), (R * 0.52, 0.67), (R * 0.4, 0.73), (R * 0.2, 0.76), (0.001, 0.765)], PAINT, cap)
    C.polar_prism(f'{name} Emblem', star(3 + i, R * 0.34, R * 0.14), 0.745, 0.035, GLOW, cap, samples=120, bevel=0.006)
    C.cylinder(f'{name} Bolt', 0.06, 0.06, 0.03, METAL, cap, loc=(0, 0, 0.78), segments=6)
    C.export(scene, f'top_{i}.glb', [root])
    roots.append(root)

# Studio render of all four, side by side (moved only after export).
for i, root in enumerate(roots):
    root.location = ((i - 1.5) * 1.6, 0, 0)
    root.children[0].rotation_euler = (0, 0, i * 0.7)
C.studio_render(scene, 'tops.png', target=(0, 0, 0.3), distance=7.5, height=3.6, azimuth=-8, lens=40, size=(1200, 600))
for root in roots:
    root.location = (0, 0, 0)
C.save_blend()
print('tops exported:', [f'top_{i}.glb' for i in range(4)])
