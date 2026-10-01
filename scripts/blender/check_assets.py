"""Checks the exported GLBs against the model contract in src/render/models.ts. No Blender needed.

  python3 scripts/blender/check_assets.py
"""
import json, pathlib, struct, sys

MODELS = pathlib.Path(__file__).resolve().parents[2] / 'public/models'
LAYOUT = json.loads((MODELS.parents[1] / 'src/arena-layout.json').read_text())
REQUIRED = {
    **{f'top_{i}.glb': {f'top_{i}', f'cap_{i}', f'ring_{i}', f'tip_{i}'} for i in range(4)},
    'mech.glb': {'mech', 'legL', 'legR', 'arms', 'thrusters'} | {f'kit_{k}' for k in ('boost', 'blink', 'phase', 'jump', 'hover', 'cloak', 'parry', 'shield', 'lock')} | {f'plate_{s}_{i}' for s in ('front', 'rear', 'left', 'right') for i in (1, 2, 3)},
    'arena.glb': {'arena'} | {f'Wall {k}' for k in range(len(LAYOUT['walls']))} | {f'Block {k}' for k in range(len(LAYOUT['buildings']))}
                 | {f'Tunnel Roof {k}' for k in range(len(LAYOUT['tunnels']))} | {f'Tree Canopy {k}' for k in range(len(LAYOUT['trees']))},
}
MAX_BYTES = 3_000_000
failed = False
for name, nodes in REQUIRED.items():
    path = MODELS / name
    if not path.exists():
        print(f'FAIL {name}: missing'); failed = True; continue
    data = path.read_bytes()
    magic, _, _ = struct.unpack('<4sII', data[:12])
    length = struct.unpack('<I', data[12:16])[0]
    doc = json.loads(data[20:20 + length])
    found = {n.get('name') for n in doc.get('nodes', [])}
    problems = []
    if magic != b'glTF': problems.append('not a GLB')
    if len(doc.get('scenes', [])) != 1: problems.append(f"{len(doc.get('scenes', []))} scenes (want 1)")
    if missing := nodes - found: problems.append(f'missing nodes {sorted(missing)}')
    if len(data) > MAX_BYTES: problems.append(f'{len(data)} bytes > {MAX_BYTES}')
    print(f"{'FAIL' if problems else 'PASS'} {name} ({len(data) // 1024} KB){': ' + '; '.join(problems) if problems else ''}")
    failed |= bool(problems)
sys.exit(1 if failed else 0)
