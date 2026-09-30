import { describe, expect, it } from 'vitest';
import { hidden } from '../src/render/scene.ts';
import { BUILDINGS, TREE, TREES, TUNNELS } from '../src/sim/city.ts';
import { CAMERA } from '../src/tuning.ts';

describe('hiding places', () => {
  it('hides a player under a tunnel roof, but not beside the tunnel', () => {
    const t = TUNNELS[0]!;
    expect(hidden(t.x, t.z)).toBe(true);
    expect(hidden(t.x, t.z - 6)).toBe(false);
  });
  it('hides a player where a tree canopy covers them on screen', () => {
    const tree = TREES[0]!;
    const shift = TREE.canopyHeight * CAMERA.back / CAMERA.height; // canopy height ÷ tan(camera pitch)
    expect(hidden(tree.x, tree.z - shift)).toBe(true);
    expect(hidden(tree.x, tree.z + 4)).toBe(false); // in front of the tree, toward the camera
  });
  it('hides a player (and so the name tag) behind a building', () => {
    const b = BUILDINGS[0]!;
    expect(hidden(b.x, b.z - b.hz - 1)).toBe(true); // just behind it, seen from the camera
    expect(hidden(b.x, b.z + b.hz + 2)).toBe(false); // in front of it
  });
  it('does not hide a player in the open plaza', () => {
    expect(hidden(0, 0)).toBe(false);
    expect(hidden(3, 3)).toBe(false);
  });
});
