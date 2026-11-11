import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, tagMode, type NightField } from './night';

const STEEL = 0x3a444e;
const SNOW = 0xe4eef4;
const WOOD = 0x3d342c;
const RUST = 0x5a4034;
const BARK = 0x2c261f;

/** One shared winter-county scale. Pieces are built to meters and instanced. */
export function bareTreeGeometry(): THREE.BufferGeometry {
  const parts = [
    column(0.07, 0.16, 3.4, BARK, 0, 1.7, 0),
    limb(1.15, 0.35, 1.7, 0.4),
    limb(1.05, -0.4, 2.05, 2.2),
    limb(0.85, 0.1, 2.45, 4.1),
    limb(0.7, -0.15, 2.8, 1.1),
    snowCap(0.38, 0.15, 3.15),
    snowCap(0.28, 0.55, 2.15),
    snowCap(0.26, -0.5, 2.45),
    snowCap(0.18, 0.05, 3.45),
  ];
  return mergeGeometries(parts, false) ?? parts[0];
}

export function railBayGeometry(): THREE.BufferGeometry {
  const parts = [
    column(0.035, 0.04, 1.45, STEEL, 0, 0.72, -1.1),
    column(0.035, 0.04, 1.45, STEEL, 0, 0.72, 1.1),
    beam(2.2, 0.045, 0.035, STEEL, 0, 0.55, 0),
    beam(2.2, 0.045, 0.035, STEEL, 0, 1.12, 0),
    box(0.16, 0.05, 0.16, SNOW, 0, 1.48, -1.1),
    box(0.16, 0.05, 0.16, SNOW, 0, 1.48, 1.1),
  ];
  return mergeGeometries(parts, false) ?? parts[0];
}

export function barrierGeometry(): THREE.BufferGeometry {
  const parts = [
    box(1.5, 0.22, 0.08, STEEL, 0, 0.72, 0),
    box(1.5, 0.06, 0.09, 0x8a7844, 0, 0.72, 0),
    box(0.08, 0.7, 0.08, STEEL, -0.62, 0.35, 0),
    box(0.08, 0.7, 0.08, STEEL, 0.62, 0.35, 0),
    box(1.35, 0.06, 0.16, SNOW, 0, 0.86, 0),
  ];
  return mergeGeometries(parts, false) ?? parts[0];
}

export function spoolGeometry(): THREE.BufferGeometry {
  const drum = new THREE.CylinderGeometry(0.22, 0.22, 0.55, 10);
  drum.rotateZ(Math.PI / 2);
  paint(drum, new THREE.Color(WOOD));
  drum.translate(0, 0.42, 0);
  const parts = [
    drum,
    disc(-0.28),
    disc(0.28),
    box(0.7, 0.06, 0.28, SNOW, 0, 0.7, 0),
  ];
  return mergeGeometries(parts, false) ?? drum;
}

export function crateGeometry(): THREE.BufferGeometry {
  const parts = [
    box(0.62, 0.42, 0.48, WOOD, 0, 0.21, 0),
    box(0.64, 0.04, 0.5, RUST, 0, 0.44, 0),
    box(0.5, 0.07, 0.36, SNOW, 0, 0.5, 0),
  ];
  return mergeGeometries(parts, false) ?? parts[0];
}

export function cabinetGeometry(): THREE.BufferGeometry {
  const parts = [
    box(0.72, 1.35, 0.42, STEEL, 0, 0.68, 0),
    box(0.5, 0.9, 0.04, 0x2a3138, 0, 0.72, 0.22),
    box(0.62, 0.08, 0.46, SNOW, 0, 1.38, 0),
  ];
  return mergeGeometries(parts, false) ?? parts[0];
}

export interface Scatter {
  x: number;
  y?: number;
  z: number;
  ry?: number;
  s?: number;
}

export function scatter(
  parent: THREE.Object3D,
  mat: THREE.Material,
  geo: THREE.BufferGeometry,
  spots: Scatter[],
  field?: NightField,
  mode = 0,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
  const dummy = new THREE.Object3D();
  spots.forEach((spot, index) => {
    const s = spot.s ?? 1;
    dummy.position.set(spot.x, spot.y ?? 0, spot.z);
    dummy.rotation.set(0, spot.ry ?? 0, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.count = spots.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (field && mode) tagMode(mesh, field, mode);
  parent.add(mesh);
  return mesh;
}

/** Posts and rails along the long axis of a fence volume. Visual only. */
export function layRails(
  parent: THREE.Object3D,
  mat: THREE.Material,
  field: NightField,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): void {
  const alongX = maxX - minX > maxZ - minZ;
  const span = alongX ? maxX - minX : maxZ - minZ;
  const bays = Math.max(1, Math.round(span / 2.2));
  const spots: Scatter[] = [];
  for (let i = 0; i < bays; i++) {
    const t = (i + 0.5) / bays;
    if (alongX) {
      spots.push({ x: minX + t * (maxX - minX), z: (minZ + maxZ) / 2, ry: Math.PI / 2 });
    } else {
      spots.push({ x: (minX + maxX) / 2, z: minZ + t * (maxZ - minZ) });
    }
  }
  scatter(parent, mat, railBayGeometry(), spots, field, 8);
}

function limb(length: number, x: number, y: number, yaw: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.025, 0.04, length, 5);
  paint(geo, new THREE.Color(BARK));
  geo.rotateZ(0.7);
  geo.rotateY(yaw);
  geo.translate(x, y, 0);
  return geo;
}

function snowCap(r: number, x: number, y: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(r, 6, 4);
  geo.scale(1, 0.45, 1);
  paint(geo, new THREE.Color(SNOW));
  geo.translate(x, y, 0);
  return geo;
}

function disc(x: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.4, 0.4, 0.06, 10);
  geo.rotateZ(Math.PI / 2);
  paint(geo, new THREE.Color(RUST));
  geo.translate(x, 0.42, 0);
  return geo;
}

function column(r0: number, r1: number, h: number, color: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(r0, r1, h, 6);
  paint(geo, new THREE.Color(color));
  geo.translate(x, y, z);
  return geo;
}

function beam(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return box(w, h, d, color, x, y, z);
}

function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  paint(geo, new THREE.Color(color));
  geo.translate(x, y, z);
  return geo;
}
