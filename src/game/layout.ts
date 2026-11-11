export interface AABB {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  tag: string;
}

function b(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  minY: number,
  maxY: number,
  tag: string,
): AABB {
  return { minX, maxX, minY, maxY, minZ, maxZ, tag };
}

/** Chapter 1, 南岸公路. Distances are playable scale, not the sign's 4 km. */
export const LAYOUT = {
  coat: { x: 0.15, z: 76 },
  policeLoot: { x: -3.35, z: 115.8 },
  ice: { z0: 170, z1: 186 },
  bridge: { z0: 192, z1: 216, half: 3.25 },
  gateZ: 262,
  sideDoor: { x: 7.25, z: 262 },
  ditch: { minX: -13.5, maxX: -4.05, minZ: 128, maxZ: 144 },
  truckStart: { x: 0, z: 12 },
  sign: { x: 5.35, z: 48 },
  enemies: [
    { x: 2.55, z: 156, line: '冷', wake: 7.2 },
    { x: -1.55, z: 224, line: '走开', wake: 6.4 },
    { x: -4.2, z: 246, line: '门……', wake: 6.2 },
  ],
};

export function staticSolids(): AABB[] {
  return [
    b(-8, 8, -14, -7, 0, 1.6, 'bank'),
    b(-14, -6.15, -7, 126, 0, 1.05, 'bank'),
    b(-14, -6.15, 146, 255, 0, 1.05, 'bank'),
    b(6.15, 14, -7, 248, 0, 1.05, 'bank'),
    b(-16.5, -13.4, -7, 290, 0, 2.2, 'block'),
    b(13.4, 16.5, -7, 290, 0, 2.2, 'block'),
    b(-5.7, -4.2, 30, 35.6, 0, 1.35, 'car'),
    b(4.2, 5.75, 100, 105.6, 0, 1.35, 'car'),
    b(-4.45, -2.25, 113.2, 118.6, 0, 1.45, 'police'),
    b(2.45, 4.15, 113.6, 118.8, 0, 1.35, 'car'),
    b(3.85, 5.5, 148, 153.4, 0, 1.35, 'car'),
    b(-3.6, -2.9, 192, 216, 0, 1.1, 'rail'),
    b(2.9, 3.6, 192, 201.5, 0, 1.1, 'rail'),
    b(2.9, 3.6, 208.5, 216, 0, 1.1, 'rail'),
    b(-1.15, -0.65, 188.4, 190.2, 0, 0.95, 'post'),
    b(0.65, 1.15, 188.4, 190.2, 0, 0.95, 'post'),
    b(5.15, 5.55, 47.5, 48.5, 0, 2.2, 'post'),
  ];
}

/** Permanent fence, optional gate leaf and side door, yard building. */
export function fenceSolids(gateOpen: boolean, sideOpen: boolean): AABB[] {
  const list: AABB[] = [
    b(-14, -1.6, 261.35, 262.7, 0, 2.5, 'fence'),
    b(1.6, 6.3, 261.35, 262.7, 0, 2.5, 'fence'),
    b(8.2, 14, 261.35, 262.7, 0, 2.5, 'fence'),
    b(-12, 12, 286, 287.2, 0, 2.6, 'fence'),
    b(-9, -1.8, 270, 277.2, 0, 5.2, 'building'),
  ];
  if (!gateOpen) list.push(b(-1.6, 1.6, 261.35, 262.7, 0, 2.5, 'fence'));
  if (!sideOpen) list.push(b(6.3, 8.2, 261.35, 262.7, 0, 2.5, 'fence'));
  return list;
}

export function worldSolids(gateOpen: boolean, sideOpen: boolean): AABB[] {
  return staticSolids().concat(fenceSolids(gateOpen, sideOpen));
}
