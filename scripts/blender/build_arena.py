"""The oval city stadium. The bowl uses the same profile as the physics (src/sim/bowl.ts, numbers from
src/tuning.ts); buildings, half walls, tunnels and trees come from src/arena-layout.json and use the same
draping as src/sim/city.ts, so what players see is what they collide with.

Run: python3 scripts/blender/mcp_run.py scripts/blender/build_arena.py
Output: public/models/arena.glb, art/renders/arena.png, art/renders/arena_close.png
Contract: tunnel bodies are `Tunnel Roof <k>`, tree tops are `Tree Canopy <k>` and each building with its
details is `Block <k>` (the game fades them).
Game (x, z) is Blender (x, -y); a layout angle turns game +X toward +Z, which is Blender rotation -angle.
"""
import bmesh, importlib.util, json, math, pathlib, random
spec = importlib.util.spec_from_file_location('spin_common', pathlib.Path(__file__).with_name('common.py'))
C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)
import bpy

A = C.tuning('ARENA')
FLOOR, RIM, RIM_H, CURVE, SX = A['floorRadius'], A['rimRadius'], A['rimHeight'], A['floorCurve'], A['stretch']
LAYOUT = json.loads((C.ROOT / 'src/arena-layout.json').read_text())
rng = random.Random(7)


def bowl_height(r):  # keep identical to bowlHeight in src/sim/bowl.ts
    floor = CURVE * min(r, FLOOR) ** 2
    if r <= FLOOR:
        return floor
    t = min(1.0, (r - FLOOR) / (RIM - FLOOR))
    return floor + (RIM_H - floor) * (1 - math.sqrt(1 - t * t))


def surface(x, z):  # game coordinates, like surfaceHeight in bowl.ts
    return bowl_height(math.hypot(x / SX, z))


def stretch(obj):
    """Turns a round lathe object into the oval: x is stretched, as in the physics."""
    for v in obj.data.vertices:
        v.co.x *= SX
    return obj


def oval_point(a, r):
    """A point on the oval at normalized radius r, and the outward normal angle there (Blender XY)."""
    x, y = math.cos(a) * r * SX, math.sin(a) * r
    return x, y, math.atan2(y, x / (SX * SX))


def band(name, r0, r1, material, steps=6, lift=0.0):
    pts = [r0 + (r1 - r0) * i / steps for i in range(steps + 1)]
    if r1 > FLOOR:  # sample the steep rim more densely toward its top
        pts = [r0 + (r1 - r0) * math.sin(i / (steps * 3) * math.pi / 2) for i in range(steps * 3 + 1)]
    return stretch(C.lathe(name, [(max(r, 0.001), bowl_height(r) + lift) for r in pts], material, root, segments=160))


def draped_box(x, z, length, depth, height, angle_deg):
    """Same as drapedBox in city.ts: returns centre (Blender), size, rotation and the top height."""
    ang = math.radians(angle_deg)
    dx, dz = math.cos(ang), math.sin(ang)
    hx, hz = length / 2, depth / 2
    hs = [surface(x + dx * hx * s - dz * hz * t, z + dz * hx * s + dx * hz * t) for s in (-1, -0.5, 0, 0.5, 1) for t in (-1, 0, 1)]
    bottom, top = min(hs) - 0.4, max(hs) + height
    return (x, -z, (bottom + top) / 2), (length, depth, top - bottom), -ang, top


def merged_boxes(name, boxes, material, parent):
    """Many small boxes as one mesh (one draw call in the game). Each box is (centre, size, z rotation)."""
    from mathutils import Matrix
    bm = bmesh.new()
    for loc, size, rz in boxes:
        m = Matrix.Translation(loc) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Diagonal((*size, 1))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    return C.from_bmesh(name, bm, material, parent, smooth=False)


def double_sided(*materials):
    for m in materials:
        m.use_backface_culling = False


scene = C.new_scene('Stadium')
root = C.empty('arena')
ASPHALT = C.mat('City Asphalt', '#232a38', metallic=0.05, roughness=0.8)
ASPHALT2 = C.mat('City Asphalt Light', '#293242', metallic=0.05, roughness=0.8)
RIMM = C.mat('Bowl Rim', '#3c4d72', metallic=0.3, roughness=0.4)
LINE = C.mat('Bowl Line', '#ff8a3d', roughness=0.35, emission='#ff7a1a', strength=1.6)
PAINT = C.mat('Road Paint', '#e9edf5', roughness=0.5, emission='#8890a0', strength=0.3)
CYAN = C.mat('Bowl Cyan', '#5fe3ff', roughness=0.3, emission='#5fe3ff', strength=2.0)
STEEL = C.mat('Stadium Steel', '#cfd7e2', metallic=1.0, roughness=0.25)
FRAME = C.mat('Stadium Frame', '#161c2a', metallic=0.4, roughness=0.6)
double_sided(ASPHALT, ASPHALT2, RIMM, LINE, CYAN, PAINT)

# ---- Bowl: asphalt bands, the orange floor line and the rim.
edges = [0, 3, 7, 11, 15, 19, FLOOR - 0.15]
for i in range(len(edges) - 1):
    band(f'Floor {i}', edges[i], edges[i + 1], ASPHALT if i % 2 else ASPHALT2)
band('Floor Line', FLOOR - 0.15, FLOOR + 0.15, LINE, steps=1)
band('Rim', FLOOR + 0.15, RIM, RIMM, steps=12)
band('Centre Ring', 3.0, 3.2, CYAN, steps=1, lift=0.02)
C.polar_prism('Centre Star', lambda a: 0.9 + 1.0 * (1 - abs(((a * 4 / math.tau) % 1) - 0.5) * 2) ** 3, 0.0, 0.03, LINE, root, samples=160, bevel=0)


# ---- Road markings: dashed centre lines along the tunnel roads.
def dash_line(x0, z0, x1, z1, gap=2.2, length=1.2):
    n = int(math.hypot(x1 - x0, z1 - z0) / gap)
    ang = math.atan2(z1 - z0, x1 - x0)
    for k in range(n):
        t = (k + 0.5) / n
        x, z = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
        if any(abs(x - b['x']) < b['w'] / 2 + 0.5 and abs(z - b['z']) < b['d'] / 2 + 0.5 for b in LAYOUT['buildings']):
            continue
        yield ((x, -z, surface(x, z) + 0.02), (length, 0.18, 0.04), -ang)


dashes = [*dash_line(-26, 10, 26, 10), *dash_line(-26, -10, 26, -10), *dash_line(18.5, -17, 18.5, 17), *dash_line(-18.5, -17, -18.5, 17)]
merged_boxes('Road Dashes', dashes, PAINT, root)

# ---- Rim lip, outer skirt, pillars and tick marks.
stretch(C.lathe('Lip', [(RIM - 0.1, RIM_H - 0.1), (RIM + 0.25, RIM_H + 0.2), (RIM + 0.6, RIM_H + 0.25), (RIM + 0.8, RIM_H), (RIM + 0.7, RIM_H - 0.3)], STEEL, root, segments=160))
stretch(C.lathe('Skirt', [(RIM + 0.7, RIM_H - 0.3), (RIM + 2.2, RIM_H - 1.4), (RIM + 3.0, -1.5), (RIM + 3.2, -3)], FRAME, root, segments=128))
for k in range(16):
    a = (k + 0.5) / 16 * math.tau
    x, y, n = oval_point(a, RIM + 2.1)
    C.box(f'Pillar {k}', (0.8, 1.2, RIM_H + 2.5), STEEL, root, (x, y, (RIM_H - 3) / 2 + 0.2), bevel=0.08, rot=(0, 0, n))
    C.box(f'Pillar Light {k}', (0.84, 0.3, 0.3), CYAN, root, (x, y, RIM_H - 0.5), bevel=0.05, rot=(0, 0, n))
for k in range(24):
    a = k / 24 * math.tau
    r = FLOOR + 3.2
    x, y, n = oval_point(a, r)
    C.box(f'Tick {k}', (0.9, 0.14, 0.05), CYAN, root, (x, y, bowl_height(r) + 0.04), bevel=0.02, rot=(0, -math.atan2(bowl_height(r + 0.3) - bowl_height(r - 0.3), 0.6), n))

# ---- Buildings: towers with lit windows and rooftop details.
FACADES = ['#4a5670', '#5b4d6e', '#3f5d66', '#6a5a4a', '#4d4f63']
WINDOW = C.mat('Window', '#ffd98a', roughness=0.2, emission='#ffcb6b', strength=2.2)
WINDOW_C = C.mat('Window Cool', '#9fe7ff', roughness=0.2, emission='#7fd8ff', strength=2.0)
ROOF = C.mat('Roof', '#2b3140', roughness=0.7)
for k, b in enumerate(LAYOUT['buildings']):
    body = C.mat(f'Facade {k % len(FACADES)}', FACADES[k % len(FACADES)], metallic=0.25, roughness=0.55)
    loc, size, rot, top = draped_box(b['x'], b['z'], b['w'], b['d'], b['h'], 0)
    block = C.empty(f'Block {k}', parent=root)
    C.box(f'Building {k}', size, body, block, loc, bevel=0.1)
    C.box(f'Building Roof {k}', (size[0] + 0.3, size[1] + 0.3, 0.3), ROOF, block, (loc[0], loc[1], top + 0.1), bevel=0.05)
    lit = WINDOW if k % 2 else WINDOW_C
    windows = []
    floors = int((b['h'] - 1.2) / 1.6)
    for f in range(floors):
        zf = top - b['h'] + 1.4 + f * 1.6
        for face, (w, nx, ny) in {'s': (b['w'], 0, 1), 'n': (b['w'], 0, -1), 'e': (b['d'], 1, 0), 'w': (b['d'], -1, 0)}.items():
            cols = int(w / 1.3)
            for c in range(cols):
                if rng.random() < 0.25:
                    continue  # some windows are dark
                off = (c - (cols - 1) / 2) * 1.3
                px = loc[0] + nx * (b['w'] / 2 + 0.02) + (off if ny else 0)
                py = loc[1] + ny * (b['d'] / 2 + 0.02) + (off if nx else 0)
                windows.append(((px, py, zf), (0.7 if ny else 0.05, 0.05 if ny else 0.7, 0.8), 0))
    merged_boxes(f'Windows {k}', windows, lit, block)
    C.box(f'Roof Unit {k}', (1.2, 1.0, 0.7), STEEL, block, (loc[0] + b['w'] * 0.2, loc[1] - b['d'] * 0.15, top + 0.55), bevel=0.05)
    if b['h'] >= 9:
        C.cylinder(f'Roof Mast {k}', 0.05, 0.03, 2.2, STEEL, block, (loc[0] - b['w'] * 0.25, loc[1] + b['d'] * 0.2, top + 1.3))
        C.sphere(f'Roof Beacon {k}', 0.12, LINE, block, (loc[0] - b['w'] * 0.25, loc[1] + b['d'] * 0.2, top + 2.45))

# ---- Half walls: concrete barriers with an orange cap.
WALL = C.mat('Wall Body', '#8d9ab3', metallic=0.3, roughness=0.5)
WALL_TOP = C.mat('Wall Cap', '#ff8a3d', roughness=0.35, emission='#ff7a1a', strength=1.2)
T, H = LAYOUT['wall']['thickness'], LAYOUT['wall']['height']
for k, w in enumerate(LAYOUT['walls']):
    loc, size, rot, top = draped_box(w['x'], w['z'], w['length'], T, H, w['angle'])
    C.box(f'Wall {k}', size, WALL, root, loc, bevel=0.06, rot=(0, 0, rot))
    C.box(f'Wall Cap {k}', (size[0] + 0.02, T + 0.04, 0.12), WALL_TOP, root, (loc[0], loc[1], top - 0.02), bevel=0.04, rot=(0, 0, rot))

# ---- Tunnels: the same draped mesh as tunnelMesh() in city.ts.
TUN = LAYOUT['tunnel']
CONCRETE = C.mat('Tunnel Concrete', '#9aa3b4', roughness=0.7)
STRIPE = C.mat('Tunnel Stripe', '#ffc93f', roughness=0.4, emission='#ffb020', strength=1.2)
double_sided(CONCRETE)


def tunnel_object(k, t, steps=8):
    L, hw, ih = TUN['length'] / 2, TUN['inner']['halfWidth'], TUN['inner']['height']
    ang = math.radians(t['angle'])
    dx, dz = math.cos(ang), math.sin(ang)
    bm = bmesh.new()

    def vert(u, v, h):
        x, z = t['x'] + u * dx - v * dz, t['z'] + u * dz + v * dx
        return bm.verts.new((x, -z, surface(x, z) + h))

    def strip(a, b):
        prev = (vert(-L, *a), vert(-L, *b))
        for i in range(1, steps + 1):
            u = -L + 2 * L * i / steps
            nxt = (vert(u, *a), vert(u, *b))
            bm.faces.new((prev[0], prev[1], nxt[1], nxt[0]))
            prev = nxt

    outer = TUN['outer']
    for i in range(len(outer) - 1):
        strip(outer[i], outer[i + 1])
    strip((hw, 0), (hw, ih)); strip((hw, ih), (-hw, ih)); strip((-hw, ih), (-hw, 0))
    o0, o1, o2, o3 = outer
    cap = [[o0, o1, (-hw, ih)], [o0, (-hw, ih), (-hw, 0)], [o1, o2, (hw, ih)], [o1, (hw, ih), (-hw, ih)], [o2, o3, (hw, 0)], [o2, (hw, 0), (hw, ih)]]
    for u in (-L, L):
        for tri in cap:
            bm.faces.new([vert(u, v, h) for v, h in tri])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    body = C.from_bmesh(f'Tunnel Roof {k}', bm, CONCRETE, root, smooth=False)
    # A glowing stripe along each roof edge, so the tunnel reads from the top-down camera.
    for v in (outer[1][0], outer[2][0]):
        x, z = t['x'] - v * dz, t['z'] + v * dx
        C.box(f'Tunnel Stripe {k} {v}', (TUN['length'], 0.2, 0.06), STRIPE, body, (x, -z, surface(x, z) + outer[1][1] + 0.03), bevel=0, rot=(0, 0, -ang))
    return body


for k, t in enumerate(LAYOUT['tunnels']):
    tunnel_object(k, t)

# ---- Trees: trunk, and a canopy of three flat-shaded blobs.
TR = LAYOUT['tree']
BARK = C.mat('Bark', '#6b4a2e', roughness=0.9)
LEAVES = [C.mat(f'Leaves {i}', c, roughness=0.85) for i, c in enumerate(['#3f9a55', '#4fae5f', '#358a4c'])]
for k, (x, z) in enumerate(LAYOUT['trees']):
    base = surface(x, z)
    C.cylinder(f'Trunk {k}', TR['trunk'] * 0.75, TR['trunk'], TR['trunkHeight'] + 1.2, BARK, root, (x, -z, base + (TR['trunkHeight'] + 1.2) / 2), segments=10)
    canopy = C.empty(f'Tree Canopy {k}', (x, -z, base + TR['canopyHeight']), root)
    for i, (ox, oy, oz, r) in enumerate([(0, 0, 0.2, 1.0), (0.9, 0.5, -0.3, 0.72), (-0.8, -0.6, -0.2, 0.75)]):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=TR['canopy'] * r)
        C.from_bmesh(f'Canopy {k} {i}', bm, LEAVES[(k + i) % 3], canopy, (ox, oy, oz), smooth=False)

C.export(scene, 'arena.glb', [root])
C.studio_render(scene, 'arena.png', target=(0, 0, 0), distance=52, height=50, azimuth=0, lens=32, size=(1400, 800))
cam = scene.camera
cam.location = (12, -24, 20)
scene.render.filepath = str(C.RENDERS / 'arena_close.png')
bpy.ops.render.render(write_still=True, scene=scene.name)
C.save_blend()
print('arena exported')
