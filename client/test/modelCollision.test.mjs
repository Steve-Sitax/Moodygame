import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, CylinderGeometry } from 'three';
import { ModelCollision, modelCollider } from '../src/world/modelCollision.ts';

const points = g => (g.index ? g.toNonIndexed() : g).getAttribute('position').array;
const cask = (x, y) => points(new CylinderGeometry(.33, .33, .88, 12).rotateX(Math.PI / 2).translate(x, y, 0));
const shape = new ModelCollision([cask(-.69, .33), cask(0, .33), cask(.69, .33), cask(-.345, .893), cask(.345, .893), cask(0, 1.456)]);

test('barrel pyramid: lower tiers support feet without a full-height invisible box', () => {
  assert.equal(shape.blocks(.9, 0, .08, .8, 2.2), false);
  assert.equal(shape.blocks(0, 0, .08, .8, 2.2), true);
  const low = shape.topAt(.8, 0, .04, 1);
  assert.ok(low > .55 && low < .67, `lower cask top ${low}`);
  assert.ok(shape.topAt(0, 0, .04, 2) > 1.77);
});
test('round barrels leave bounding-box corners and inter-barrel gaps open', () => {
  const barrel = new ModelCollision([points(new CylinderGeometry(.3, .3, 1, 12).translate(0, .5, 0))]);
  assert.equal(barrel.blocks(.28, .28, .02, .36, 1.75), false);
  assert.equal(barrel.blocks(.29, 0, .04, .36, 1.75), true);
  assert.equal(shape.blocks(.345, 0, .005, .01, .12), false);
});
test('rotated crate follows its faces, not its larger world AABB', () => {
  const crate = new ModelCollision([points(new BoxGeometry(2, 1, .4).translate(0, .5, 0))]);
  const rect = modelCollider(crate, 10, 20, Math.PI / 4);
  assert.equal(rect.surface.blocks(10.7, 20.7, .05, 0, .36), false);
  assert.equal(rect.surface.blocks(10.15, 20.15, .05, 0, .36), true);
  assert.equal(rect.surface.topAt(10, 20, .1, 1.1), 1);
});
test('table overhang leaves space underneath and does not become a floor from below', () => {
  const table = new ModelCollision([points(new BoxGeometry(2, .12, 2).translate(0, 2.2, 0))]);
  assert.equal(table.blocks(0, 0, .3, .36, 1.75), false);
  assert.equal(table.topAt(0, 0, .1, .36), -Infinity);
  assert.ok(table.topAt(0, 0, .1, 3) > 2.25);
});
test('sloping surfaces give their actual height, including a disk entirely within a face', () => {
  const slope = new ModelCollision([[-2,0,-2, -2,0,2, 2,2,2, -2,0,-2, 2,2,2, 2,2,-2]]);
  assert.ok(Math.abs(slope.topAt(0, 0, .2, 2) - 1.1) < 1e-5);
});
test('scaled and mirrored assets use the transformed mesh, including raised placement', () => {
  const box = new ModelCollision([points(new BoxGeometry(1, 1, 1).translate(0, .5, 0))]);
  const rect = modelCollider(box, 0, 0, 0, .4, -2, .5, .2);
  assert.equal(rect.surface.blocks(0, .2, .02, 0, .36), false);
  assert.ok(Math.abs(rect.surface.topAt(0, 0, .05, 1) - .9) < 1e-6);
});

test('uniformly scaled tree instances share the grid while preserving world-space contact', () => {
  const trunk = new ModelCollision([points(new CylinderGeometry(.15, .2, 3, 7).translate(0, 1.5, 0))]);
  trunk.atScale = () => { throw new Error('uniform instances must share their triangle grid'); };
  for (const k of [.65, 1, 1.4]) {
    const rect = modelCollider(trunk, 8, 11, .42, .3, k, k, k);
    assert.equal(rect.surface.blocks(8 + .17 * k, 11, .2, .3, .36), true);
    assert.equal(rect.surface.blocks(8 + k * .2 + .21, 11, .2, .3, .36), false);
    assert.ok(Math.abs(rect.surface.topAt(8, 11, .02, 6) - (.3 + 3 * k)) < 1e-5);
  }
});
