import type { AABB } from '../layout';

function box(minX: number, maxX: number, minZ: number, maxZ: number, tag: string, maxY = 3.2): AABB {
  return { minX, maxX, minY: 0, maxY, minZ, maxZ, tag };
}

export interface DoorLocks {
  capacitor: boolean;
  main: boolean;
  west: boolean;
}

/** Chapter 2, 南岸变电站. Local meters. +Z is deeper into the station, then the auxiliary road. */
export const STATION = {
  spawn: { x: 0, z: 2.7 },
  colleagueA: { x: 5.4, z: 11.1 },
  colleagueB: { x: 0, z: 16.85 },
  chair: { x: 0, z: 15.35 },
  panel: { x: 8.2, z: 23.2 },
  inlet2: { x: 8.15, z: 21.5 },
  protect: { x: 8.15, z: 23.2 },
  feeder: { x: 8.15, z: 24.9 },
  inlet1: { x: 8.35, z: 27.15 },
  phone: { x: 5.15, z: 21.15 },
  gloves: { x: -8.7, z: 9.35 },
  headlamp: { x: -5.15, z: 12.45 },
  fuses: { x: -8.7, z: 12.7 },
  tea: { x: -7.15, z: 10.35 },
  roster: { x: -4.4, z: 8.42 },
  extinguisher: { x: 2.15, z: 20.7 },
  blower: { x: -8.4, z: 24.2 },
  isolator: { x: -1.2, z: 23.4 },
  exitIsolator: { x: 10.6, z: 31.6 },
  sideDoor: { x: 8.6, z: 28.25 },
  escapeZ: 45.2,
  lamps: [32.2, 36.2, 40.2, 44.2, 47.6],
  stiffs: [
    { x: 6.15, z: 34.2 },
    { x: 6.45, z: 39.4 },
    { x: 6.05, z: 43.2 },
  ],
};

export function stationSolids(locks: DoorLocks): AABB[] {
  const list: AABB[] = [
    box(-12.2, 12.2, 0.15, 0.55, 'fence'),
    box(-12.2, -11.6, 0.2, 8.2, 'fence'),
    box(11.6, 12.2, 0.2, 8.2, 'fence'),
    box(11.6, 13.8, 8.2, 28.6, 'fence'),
    box(-14.4, -11.6, 8.2, 28.6, 'fence'),
    box(-11.6, -1.35, 7.75, 8.2, 'wall'),
    box(1.35, 11.6, 7.75, 8.2, 'wall'),
    box(-11.6, -11.15, 7.75, 28.5, 'wall'),
    box(11.15, 11.6, 7.75, 28.5, 'wall'),
    box(-11.6, -4.3, 28.05, 28.5, 'wall'),
    box(-4.3, 3.3, 28.05, 28.5, 'ghost'),
    box(3.3, 7.5, 28.05, 28.5, 'wall'),
    box(9.7, 11.6, 28.05, 28.5, 'wall'),
    box(-3.55, -3.15, 8.2, 10.05, 'wall'),
    box(-3.55, -3.15, 12.05, 19.45, 'wall'),
    box(3.15, 3.55, 8.2, 10.05, 'wall'),
    box(3.15, 3.55, 12.05, 14.2, 'wall'),
    box(-3.15, -0.85, 14.2, 14.6, 'wall'),
    box(0.85, 11.15, 14.2, 14.6, 'wall'),
    box(-3.15, -0.68, 14.6, 19.45, 'fill'),
    box(0.68, 11.15, 14.6, 19.45, 'fill'),
    box(-11.15, -9.35, 19.45, 19.9, 'wall'),
    box(-7.25, -0.85, 19.45, 19.9, 'wall'),
    box(0.85, 11.15, 19.45, 19.9, 'wall'),
    box(9.5, 11.05, 20.6, 26.8, 'panel', 1.25),
    box(6.3, 8.5, 9.1, 10.5, 'prop', 1.55),
    box(8.7, 10.5, 12.1, 13.3, 'prop', 1.55),
    box(-11.05, -9.55, 8.7, 13.5, 'prop', 1.9),
    box(-8.4, -6.1, 10.85, 11.45, 'prop', 0.52),
    box(5.55, 6.85, 20.75, 21.55, 'prop', 0.74),
    box(4.5, 7.5, 1.5, 4.1, 'prop', 1.7),
    box(4.7, 5.15, 28.5, 49.5, 'curb', 0.9),
    box(12.7, 13.2, 28.5, 49.5, 'curb', 0.9),
    box(5.15, 12.7, 49.3, 49.8, 'curb', 1.2),
  ];
  if (locks.capacitor) list.push(box(3.15, 3.55, 10.05, 12.05, 'wall'));
  if (locks.main) list.push(box(-0.85, 0.85, 19.45, 19.9, 'wall'));
  if (locks.west) list.push(box(-9.35, -7.25, 19.45, 19.9, 'wall'));
  return list;
}

export function inControl(x: number, z: number): boolean {
  return x > -11.05 && x < 11.05 && z > 19.9 && z < 28.0;
}

export function indoors(x: number, z: number): boolean {
  return x > -11.45 && x < 11.45 && z > 8.05 && z < 27.95;
}

/** Yard, locker wing, and the north road. The corridor and control room are not safe. */
export function inSafe(x: number, z: number): boolean {
  if (z < 7.65 && x > -12 && x < 12.2) return true;
  if (x < -3.6 && z > 8.1 && z < 19.45) return true;
  if (z > 28.6 && x > -2 && x < 16) return true;
  return false;
}

export function fireDps(x: number, z: number): number {
  if (inSafe(x, z)) return 0;
  if (inControl(x, z)) return 18;
  if (z > 14.6 && z < 19.9 && Math.abs(x) < 1.05) return 7;
  if (x > -11.2 && x < 11.2 && z > 8 && z < 28.2) return 5;
  return 0;
}

export function onEscapeRoad(x: number, z: number): boolean {
  return z > STATION.escapeZ && x > 5.3 && x < 12.5;
}
