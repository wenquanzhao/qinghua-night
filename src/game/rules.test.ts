import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAYOUT, staticSolids, fenceSolids } from './layout.ts';
import { TUNE } from './tune.ts';
import { blockedAt, environmentFail, formatClock, formatDuration, impactKind, planarWish, steerYaw } from './rules.ts';

test('formats survival time and the night clock', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(75), '01:15');
  assert.equal(formatClock(0), '02:17');
  assert.equal(formatClock(60), '02:18');
});

test('strafe and steer face the right side when looking down the road', () => {
  const forward = planarWish(0, 0, 1);
  assert.ok(forward.z > 0);
  assert.ok(Math.abs(forward.x) < 1e-9);
  assert.ok(planarWish(0, 1, 0).x < 0, 'D moves toward world -X, which is right when facing +Z');
  assert.ok(planarWish(0, -1, 0).x > 0, 'A moves toward world +X, which is left when facing +Z');
  const turned = steerYaw(0, 1);
  assert.ok(turned < 0);
  assert.ok(planarWish(turned, 0, 1).x < 0, 'a right turn points the nose to the right');
  const looked = steerYaw(0.4, 0.2);
  assert.ok(looked < 0.4, 'mouse right uses the same sign as steering right');
  const side = planarWish(0.7, 1, 0);
  const ahead = planarWish(0.7, 0, 1);
  assert.ok(Math.abs(side.x * ahead.x + side.z * ahead.z) < 1e-9);
});

test('ram only when the bumper is close and fast', () => {
  assert.equal(impactKind(1, 8, TUNE.ramRadius, TUNE.ramSpeed), 'ram');
  assert.equal(impactKind(1, 2, TUNE.ramRadius, TUNE.ramSpeed), 'block');
  assert.equal(impactKind(4, 9, TUNE.ramRadius, TUNE.ramSpeed), 'none');
});

test('the county road center stays walkable up to the gate', () => {
  const solids = staticSolids();
  for (let z = 0; z <= 258; z += 0.5) {
    assert.equal(blockedAt(0.2, z, TUNE.footRadius, solids), false, `foot z=${z}`);
    assert.equal(environmentFail(0.2, z, LAYOUT.ditch, LAYOUT.bridge), null, `fail z=${z}`);
  }
});

test('a truck can drive the lane and can pass the person in the road', () => {
  const solids = staticSolids();
  for (let z = 8; z <= 168; z += 1) {
    assert.equal(blockedAt(0, z, TUNE.truckRadius, solids), false, `truck z=${z}`);
  }
  for (let z = 68; z <= 84; z += 1) {
    assert.equal(blockedAt(TUNE.passX, z, TUNE.truckRadius, solids), false, `pass z=${z}`);
  }
  const dist = Math.abs(TUNE.passX - LAYOUT.coat.x);
  assert.ok(dist > TUNE.ramRadius);
});

test('ice is before the bridge, and the ditch is a real fail off the asphalt', () => {
  assert.ok(LAYOUT.ice.z1 < LAYOUT.bridge.z0);
  assert.equal(environmentFail(-5, 136, LAYOUT.ditch, LAYOUT.bridge), 'ditch');
  assert.equal(environmentFail(0, 136, LAYOUT.ditch, LAYOUT.bridge), null);
  assert.equal(environmentFail(3.6, 204, LAYOUT.ditch, LAYOUT.bridge), 'ditch');
  assert.equal(environmentFail(0, 204, LAYOUT.ditch, LAYOUT.bridge), null);
});

test('both doors can be reached, and a shut gate stops the lane', () => {
  const shut = staticSolids().concat(fenceSolids(false, false));
  const openMain = staticSolids().concat(fenceSolids(true, false));
  const openSide = staticSolids().concat(fenceSolids(false, true));
  assert.equal(blockedAt(0, 262, TUNE.footRadius, shut), true);
  assert.equal(blockedAt(0, 262, TUNE.footRadius, openMain), false);
  assert.equal(blockedAt(LAYOUT.sideDoor.x, 258, TUNE.footRadius, shut), false);
  assert.equal(blockedAt(LAYOUT.sideDoor.x, 262, TUNE.footRadius, shut), true);
  assert.equal(blockedAt(LAYOUT.sideDoor.x, 262, TUNE.footRadius, openSide), false);
  assert.equal(blockedAt(0, 266, TUNE.footRadius, openMain), false);
  assert.equal(blockedAt(LAYOUT.sideDoor.x, 266, TUNE.footRadius, openSide), false);
});
