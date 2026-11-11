import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCircle } from '../collide.ts';
import { blockedAt } from '../rules.ts';
import { TUNE } from '../tune.ts';
import {
  STATION,
  fireDps,
  inControl,
  inSafe,
  indoors,
  onEscapeRoad,
  stationSolids,
  type DoorLocks,
} from './layout.ts';
import { applyThrow, blankBreakers, canBind, feederLive, nextOrder, throwBreaker } from './switches.ts';

const openDoors: DoorLocks = { capacitor: false, main: false, west: false };

function assertPath(points: { x: number; z: number }[], locks: DoorLocks, name: string): void {
  const solids = stationSolids(locks);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.35));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      assert.equal(blockedAt(x, z, TUNE.footRadius, solids), false, `${name} ${x.toFixed(2)},${z.toFixed(2)}`);
    }
  }
}

test('feeder closes only as inlet 2, protection reset, then feeder', () => {
  let state = blankBreakers();
  assert.equal(nextOrder(state), 'inlet2');
  assert.equal(throwBreaker(state, 'feeder').ok, 'trip');
  assert.equal(throwBreaker(state, 'protect').ok, 'trip');
  assert.equal(throwBreaker(state, 'inlet1').ok, 'short');
  assert.equal(feederLive(state), false);

  let step = applyThrow(state, 'inlet2');
  assert.equal(step.ok, 'set');
  assert.equal(step.live, false);
  state = step.state;
  assert.equal(nextOrder(state), 'protect');
  assert.equal(applyThrow(state, 'feeder').ok, 'trip');
  assert.equal(applyThrow(state, 'feeder').state.inlet2, false);

  step = applyThrow(state, 'protect');
  state = step.state;
  assert.equal(nextOrder(state), 'feeder');
  step = applyThrow(state, 'feeder');
  assert.equal(step.ok, 'set');
  assert.equal(step.live, true);
  assert.equal(nextOrder(step.state), 'live');
  assert.equal(applyThrow(step.state, 'feeder').ok, 'noop');
});

test('a wrong order trips and a faulted inlet is a short, not a trip', () => {
  const tripped = applyThrow(blankBreakers(), 'feeder');
  assert.equal(tripped.ok, 'trip');
  assert.equal(tripped.live, false);
  assert.deepEqual(tripped.state, blankBreakers());
  const burned = applyThrow({ inlet2: true, protect: true, feeder: false }, 'inlet1');
  assert.equal(burned.ok, 'short');
  assert.equal(burned.live, false);
  assert.equal(burned.state.feeder, false);
});

test('the chair bind needs a downed colleague next to a free chair', () => {
  const chair = STATION.chair;
  assert.equal(canBind(chair.x, chair.z + 0.4, chair.x, chair.z + 1.2, chair.x, chair.z, true, false, true), true);
  assert.equal(canBind(chair.x, chair.z, 8, 23, chair.x, chair.z, true, false, true), false);
  assert.equal(canBind(chair.x, chair.z, chair.x, chair.z, chair.x, chair.z, false, false, true), false);
  assert.equal(canBind(chair.x, chair.z, chair.x, chair.z, chair.x, chair.z, true, true, true), false);
  assert.equal(canBind(chair.x, chair.z, chair.x, chair.z, chair.x, chair.z, true, false, false), false);
});

test('both routes reach the panel, the window does not, and the road does', () => {
  assertPath(
    [
      STATION.spawn,
      { x: 0, z: 12 },
      { x: 0, z: 16.2 },
      { x: 0, z: 21 },
      { x: STATION.panel.x, z: STATION.panel.z },
    ],
    openDoors,
    'main',
  );
  assertPath(
    [
      { x: 0, z: 10 },
      { x: -5.2, z: 11 },
      { x: -7.2, z: 17 },
      { x: -8.3, z: 20.5 },
      { x: -6, z: 25.2 },
      { x: STATION.panel.x, z: STATION.feeder.z },
    ],
    openDoors,
    'west',
  );
  assertPath(
    [
      { x: 8.6, z: 26.5 },
      STATION.sideDoor,
      { x: 10, z: 36 },
      { x: 10, z: 46 },
    ],
    openDoors,
    'road',
  );
  const solids = stationSolids(openDoors);
  for (const spot of [STATION.inlet2, STATION.protect, STATION.feeder, STATION.inlet1, STATION.phone, STATION.gloves, STATION.tea, STATION.fuses, STATION.headlamp]) {
    assert.equal(blockedAt(spot.x, spot.z, TUNE.footRadius, solids), false, `${spot.x},${spot.z}`);
  }
  assert.equal(blockedAt(0, 28.25, TUNE.footRadius, solids), true);
  assert.equal(blockedAt(STATION.sideDoor.x, STATION.sideDoor.z, TUNE.footRadius, solids), false);
});

test('a locked capacitor door seals that room, and the corridor colleague blocks the main door', () => {
  const locked = stationSolids({ capacitor: true, main: false, west: false });
  const open = stationSolids(openDoors);
  assert.equal(blockedAt(3.35, 11, TUNE.footRadius, locked), true);
  assert.equal(blockedAt(3.35, 11, TUNE.footRadius, open), false);
  assert.equal(blockedAt(STATION.colleagueA.x, STATION.colleagueA.z, TUNE.footRadius, locked), false);
  assertPath(
    [
      { x: -7, z: 16 },
      { x: -8.3, z: 20.6 },
      { x: STATION.panel.x, z: STATION.panel.z },
    ],
    { capacitor: true, main: true, west: false },
    'around a locked main door',
  );
  assert.equal(blockedAt(0, 19.65, TUNE.footRadius, stationSolids({ capacitor: false, main: true, west: false })), true);

  let x = 0;
  let z = 14.95;
  const circle = [{ x: STATION.colleagueB.x, z: STATION.colleagueB.z, r: 0.42 }];
  for (let i = 0; i < 48; i++) {
    const step = resolveCircle(x, z + 0.22, TUNE.footRadius, open, circle);
    x = step.x;
    z = step.z;
  }
  assert.ok(z < 17.6, `walked through the colleague to z=${z}`);
});

test('fire hurts in the control room and ends on the yard, in the locker, or on the road', () => {
  assert.ok(fireDps(STATION.panel.x, STATION.panel.z) >= 18);
  assert.equal(fireDps(STATION.spawn.x, STATION.spawn.z), 0);
  assert.equal(fireDps(STATION.gloves.x, STATION.gloves.z), 0);
  assert.equal(fireDps(10, 40), 0);
  assert.ok(fireDps(0, 17) > 0);
  assert.equal(inSafe(0, 17), false);
  assert.equal(inControl(STATION.panel.x, STATION.panel.z), true);
  assert.equal(indoors(STATION.panel.x, STATION.panel.z), true);
  assert.equal(indoors(STATION.spawn.x, STATION.spawn.z), false);
  assert.equal(onEscapeRoad(10, 46), true);
  assert.equal(onEscapeRoad(10, 30), false);
});
