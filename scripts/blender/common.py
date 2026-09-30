"""Shared helpers for the Spin Arena Blender MCP build scripts.

Axes: Blender is Z-up. The glTF export converts to Y-up, and Blender -Y becomes game +Z (forward).
So in these scripts: forward is -Y, up is +Z, and the game's left side (+X) is Blender +X.
"""
import bpy, bmesh, math, pathlib, re
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[2]
MODELS = ROOT / 'public/models'
RENDERS = ROOT / 'art/renders'
BLEND = ROOT / 'art/spin-arena.blend'


def tuning(block):
    """Reads numbers from one `export const BLOCK = { ... }` in src/tuning.ts, so art and physics match."""
    text = (ROOT / 'src/tuning.ts').read_text()
    body = re.search(r'export const ' + block + r' = \{(.*?)\n\};', text, re.S).group(1)
    return {k: float(v) for k, v in re.findall(r'(\w+):\s*(-?[\d.]+)', body)}


def new_scene(name):
    old = bpy.data.scenes.get(name)
    if old:
        for obj in list(old.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(old)
    scene = bpy.data.scenes.new(name)
    bpy.context.window.scene = scene
    scene.unit_settings.system = 'METRIC'
    return scene


def mat(name, color, metallic=0.0, roughness=0.5, emission=None, strength=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*hex_rgb(color), 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*hex_rgb(emission), 1)
        bsdf.inputs['Emission Strength'].default_value = strength
    else:
        bsdf.inputs['Emission Strength'].default_value = 0
    return m


def hex_rgb(h):
    h = h.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def link(obj, parent=None, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


def empty(name, loc=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    obj.location = loc
    obj.empty_display_size = 0.3
    return link(obj, parent)


def from_bmesh(name, bm, material, parent=None, loc=(0, 0, 0), smooth=True, bevel=0.0, segments=2):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)
    for p in mesh.polygons:
        p.use_smooth = smooth
    obj = bpy.data.objects.new(name, mesh)
    obj.location = loc
    link(obj, parent)
    if bevel:
        mod = obj.modifiers.new('Bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
    if smooth:
        obj.modifiers.new('Normals', 'WEIGHTED_NORMAL').keep_sharp = True
    return obj


def box(name, size, material, parent=None, loc=(0, 0, 0), bevel=0.04, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    obj = from_bmesh(name, bm, material, parent, loc, smooth=True, bevel=bevel, segments=2)
    obj.rotation_euler = rot
    return obj


def cylinder(name, r1, r2, depth, material, parent=None, loc=(0, 0, 0), segments=32, bevel=0.0, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=r1, radius2=r2, depth=depth)
    obj = from_bmesh(name, bm, material, parent, loc, smooth=True, bevel=bevel)
    obj.rotation_euler = rot
    return obj


def sphere(name, radius, material, parent=None, loc=(0, 0, 0), scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=radius)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    return from_bmesh(name, bm, material, parent, loc)


def polar_prism(name, fn, z0, height, material, parent=None, samples=180, bevel=0.015):
    """Extrudes the outline r = fn(theta) between z0 and z0 + height. Faces fan from the centre,
    so any outline that is star-shaped about the centre gives valid geometry."""
    bm = bmesh.new()
    bottom, top = [], []
    for i in range(samples):
        a = i / samples * math.tau
        r = fn(a)
        bottom.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z0)))
        top.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z0 + height)))
    cb = bm.verts.new((0, 0, z0))
    ct = bm.verts.new((0, 0, z0 + height))
    for i in range(samples):
        j = (i + 1) % samples
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
        bm.faces.new((ct, top[i], top[j]))
        bm.faces.new((cb, bottom[j], bottom[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return from_bmesh(name, bm, material, parent, smooth=True, bevel=bevel, segments=2)


def lathe(name, profile, material, parent=None, segments=48, smooth=True):
    """Revolves a list of (radius, z) points about Z."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for j in range(segments):
            a = j / segments * math.tau
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for j in range(segments):
            k = (j + 1) % segments
            bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return from_bmesh(name, bm, material, parent, smooth=smooth)


def export(scene, filename, roots):
    """Exports only `roots` and their children as a GLB."""
    MODELS.mkdir(parents=True, exist_ok=True)
    for obj in bpy.data.objects:
        try:
            obj.select_set(False)
        except RuntimeError:
            pass  # not in the current view layer
    for root in roots:
        root.select_set(True)
        for child in root.children_recursive:
            child.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(MODELS / filename), export_format='GLB', use_selection=True, use_active_scene=True,
                              export_apply=True, export_yup=True, export_materials='EXPORT',
                              export_animations=False, export_cameras=False, export_lights=False)
    return MODELS / filename


def studio_render(scene, filename, target=(0, 0, 0.5), distance=4.0, height=2.2, azimuth=-35, lens=50, size=(900, 700)):
    """Adds a camera and three lights in their own collection, renders, and saves a PNG for review."""
    col = bpy.data.collections.new(scene.name + ' Studio')
    scene.collection.children.link(col)
    a = math.radians(azimuth)
    cam_data = bpy.data.cameras.new('Studio Camera')
    cam_data.lens = lens
    cam = bpy.data.objects.new('Studio Camera', cam_data)
    cam.location = (target[0] + math.sin(a) * distance, target[1] - math.cos(a) * distance, target[2] + height)
    col.objects.link(cam)
    look = bpy.data.objects.new('Studio Target', None)
    look.location = target
    col.objects.link(look)
    track = cam.constraints.new('TRACK_TO')
    track.target = look
    scene.camera = cam
    for name, loc, power, color in [('Key', (3, -4, 6), 900, (1, 0.96, 0.9)), ('Fill', (-5, -2, 3), 350, (0.8, 0.88, 1)), ('Rim', (0, 5, 5), 600, (1, 1, 1))]:
        light = bpy.data.lights.new(name, 'AREA')
        light.energy = power * (distance / 4) ** 2
        light.size = 3
        light.color = color
        obj = bpy.data.objects.new(name, light)
        obj.location = (target[0] + loc[0] * distance / 4, target[1] + loc[1] * distance / 4, target[2] + loc[2] * distance / 4)
        col.objects.link(obj)
        t = obj.constraints.new('TRACK_TO')
        t.target = look
    world = bpy.data.worlds.get('Spin Studio') or bpy.data.worlds.new('Spin Studio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.012, 0.016, 0.03, 1)
    scene.world = world
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    RENDERS.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(RENDERS / filename)
    bpy.ops.render.render(write_still=True, scene=scene.name)
    return RENDERS / filename


def save_blend():
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), copy=True)
