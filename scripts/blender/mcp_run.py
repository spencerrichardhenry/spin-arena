"""Send a build script to Blender through the Blender MCP add-on socket (execute_code).

  python3 scripts/blender/mcp_run.py scripts/blender/build_top.py
"""
import json, pathlib, socket, sys

script = pathlib.Path(sys.argv[1]).resolve()
code = f"__file__ = {str(script)!r}\n" + script.read_text()
with socket.create_connection(('127.0.0.1', 9876), timeout=600) as s:
    s.sendall(json.dumps({'type': 'execute_code', 'params': {'code': code}}).encode())
    buf = b''
    while True:
        chunk = s.recv(65536)
        if not chunk: break
        buf += chunk
        try: reply = json.loads(buf); break
        except json.JSONDecodeError: continue
if reply.get('status') == 'error':
    print(reply.get('message')); sys.exit(1)
print(reply.get('result', {}).get('result', ''))
