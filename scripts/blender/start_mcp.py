"""Start Blender with the Blender MCP add-on server on port 9876, without installing the add-on.

  /Applications/Blender.app/Contents/MacOS/Blender --python scripts/blender/start_mcp.py
"""
import bpy, glob, importlib.util, os

paths = glob.glob(os.path.expanduser('~/.local/share/uv/tools/blender-mcp/lib/python*/site-packages/blender_mcp/bundled/addon.py'))
spec = importlib.util.spec_from_file_location('blender_mcp_addon', paths[0])
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)
addon.register()

def start():
    if not getattr(bpy.types, 'blendermcp_server', None):
        bpy.types.blendermcp_server = addon.BlenderMCPServer(port=9876)
    if not bpy.types.blendermcp_server.running:
        bpy.types.blendermcp_server.start()
    print('[spin-arena] Blender MCP server running on 9876')
    return None

bpy.app.timers.register(start, first_interval=1.0)
