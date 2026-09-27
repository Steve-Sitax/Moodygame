import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ModelCollision, modelCollider } from '../src/world/modelCollision.ts';

// Generated from the actual Blender models by tools/blender/preview_quay_props.py.
const fixture = new URL('../../data/tight-assets-meshes.json', import.meta.url);
const models = fs.existsSync(fixture) ? JSON.parse(fs.readFileSync(fixture, 'utf8')) : null;
test('actual quay models: curved pyramid sides and separate landing tiers', { skip: !models && 'Run preview_quay_props.py in Blender first' }, () => {
  const s = new ModelCollision([models.casks_pyramid]);
  assert.equal(s.blocks(0, .85, .04, .9, 2.65), false);
  assert.equal(s.blocks(0, 0, .04, .9, 2.65), true);
  const heights = [.85, .4, 0].map(z => s.topAt(0, z, .03, 2));
  assert.ok(heights[0] > .55 && heights[0] < .67);
  assert.ok(heights[1] > 1.1 && heights[1] < 1.25);
  assert.ok(heights[2] > 1.7 && heights[2] < 1.8);
});
test('actual quay models: every solid model builds finite bounds and rotates without changing support height', { skip: !models }, () => {
  let checked = 0;
  for (const [name, vertices] of Object.entries(models)) {
    const s = new ModelCollision([vertices]);
    assert.ok(s.bounds.every(Number.isFinite), name);
    const [x0, , z0, x1, , z1] = s.bounds;
    const yaw = .713, c = Math.cos(yaw), sn = Math.sin(yaw);
    const rect = modelCollider(s, 12, -8, yaw, .12);
    for (let i = 1; i < 4; i++) for (let j = 1; j < 4; j++) {
      const x = x0 + (x1 - x0) * i / 4, z = z0 + (z1 - z0) * j / 4;
      const local = s.topAt(x, z, .03, 10);
      const world = rect.surface.topAt(12 + x * c + z * sn, -8 - x * sn + z * c, .03, 10.12);
      if (Number.isFinite(local)) assert.ok(Math.abs(world - local - .12) < 1e-5, name);
      else assert.equal(world, -Infinity, name);
      checked++;
    }
  }
  assert.ok(checked > 400);
});
