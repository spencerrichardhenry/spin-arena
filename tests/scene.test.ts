import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeTree, fadeCopy } from '../src/render/scene.ts';

describe('arena meshes', () => {
  it('a fade copy starts fully visible, even when the source was faded', () => {
    // The city model is cached; its materials may still hold the fade from the last round on it.
    const faded = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.25, depthWrite: false });
    const copy = fadeCopy(faded);
    expect(copy).not.toBe(faded);
    expect(copy.opacity).toBe(1);
    expect(copy.depthWrite).toBe(true);
    expect(copy.transparent).toBe(true);
  });
  it('frees geometry, materials and textures of a built-in arena, and only the material copies of the cached model', () => {
    const tex = new THREE.Texture(), geo = new THREE.BoxGeometry(), mat = new THREE.MeshStandardMaterial({ map: tex });
    const root = new THREE.Group(); root.add(new THREE.Mesh(geo, mat));
    const spies = [vi.spyOn(geo, 'dispose'), vi.spyOn(mat, 'dispose'), vi.spyOn(tex, 'dispose')];
    disposeTree(root, true);
    expect(spies.map(s => s.mock.calls.length)).toEqual([1, 1, 1]);
    const tex2 = new THREE.Texture(), geo2 = new THREE.BoxGeometry(), mat2 = new THREE.MeshStandardMaterial({ map: tex2 });
    const cached = new THREE.Group(); cached.add(new THREE.Mesh(geo2, mat2));
    const spies2 = [vi.spyOn(geo2, 'dispose'), vi.spyOn(mat2, 'dispose'), vi.spyOn(tex2, 'dispose')];
    disposeTree(cached, false);
    expect(spies2.map(s => s.mock.calls.length)).toEqual([0, 1, 0]);
  });
});
