import * as THREE from 'three';
import { meshBox } from '../render/night';

export interface FigureParts {
  root: THREE.Group;
  torso: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
}

export interface FigureOpts {
  coat: number;
  skin: number;
  pants?: number;
  scarf?: number;
  badge?: boolean;
  frost?: boolean;
  thin?: boolean;
}

/** Winter figure. Joint pivots so a walk cycle reads as a person, not a stack of crates. */
export function buildWinterFigure(mat: THREE.Material, opts: FigureOpts): FigureParts {
  const thin = opts.thin ? 0.82 : 1;
  const pants = opts.pants ?? 0x241c1a;
  const scarf = opts.scarf ?? 0x5c2e2e;
  const root = new THREE.Group();
  const torso = pivot(mat, 0.52 * thin, 0.46, 0.3 * thin, opts.coat, 0, 1.22, 0);
  const chest = meshBox(mat, 0.46 * thin, 0.22, 0.26 * thin, opts.coat);
  chest.position.set(0, 0.08, 0.02);
  const hem = meshBox(mat, 0.58 * thin, 0.28, 0.34 * thin, shade(opts.coat, 0.82));
  hem.position.set(0, -0.34, 0.03);
  const lapel = meshBox(mat, 0.1, 0.28, 0.06, shade(opts.coat, 0.7));
  lapel.position.set(-0.1, 0.02, 0.16);
  const lapelR = lapel.clone();
  lapelR.position.x = 0.1;
  torso.add(chest, hem, lapel, lapelR);
  const scarfM = meshBox(mat, 0.28 * thin, 0.08, 0.22, scarf);
  scarfM.position.set(0, 0.28, 0.08);
  const belt = meshBox(mat, 0.5 * thin, 0.06, 0.32 * thin, 0x1a1614);
  belt.position.set(0, -0.22, 0.02);
  const brim = meshBox(mat, 0.26 * thin, 0.04, 0.12, opts.coat);
  brim.position.set(0, 0.42, 0.16);
  torso.add(scarfM, belt, brim);
  if (opts.badge) {
    const card = meshBox(mat, 0.1, 0.13, 0.02, 0xe6d7a4);
    card.position.set(0.12, 0.02, 0.18);
    torso.add(card);
  }
  const snowL = meshBox(mat, 0.16, 0.05, 0.16, 0xe7eef4);
  snowL.position.set(-0.22, 0.24, 0);
  const snowR = snowL.clone();
  snowR.position.x = 0.22;
  torso.add(snowL, snowR);

  const legL = limb(mat, 0.16 * thin, 0.42, 0.17, pants, -0.12, 0.9, 0);
  const shinL = limb(mat, 0.14 * thin, 0.38, 0.15, pants, 0, -0.42, 0.02);
  const bootL = meshBox(mat, 0.16, 0.1, 0.28, 0x14110f);
  bootL.position.set(0, -0.4, 0.06);
  shinL.add(bootL);
  legL.add(shinL);
  const legR = limb(mat, 0.16 * thin, 0.42, 0.17, pants, 0.12, 0.9, 0);
  const shinR = limb(mat, 0.14 * thin, 0.38, 0.15, pants, 0, -0.42, 0.02);
  const bootR = meshBox(mat, 0.16, 0.1, 0.28, 0x14110f);
  bootR.position.set(0, -0.4, 0.06);
  shinR.add(bootR);
  legR.add(shinR);

  const armL = limb(mat, 0.13 * thin, 0.28, 0.13, opts.coat, -0.34 * thin, 1.38, 0);
  armL.rotation.z = 0.18;
  const foreL = limb(mat, 0.11 * thin, 0.26, 0.12, opts.coat, 0, -0.28, 0.02);
  const handL = meshBox(mat, 0.1, 0.08, 0.1, 0x2a2420);
  handL.position.set(0, -0.28, 0.02);
  foreL.add(handL);
  armL.add(foreL);
  const armR = limb(mat, 0.13 * thin, 0.28, 0.13, opts.coat, 0.34 * thin, 1.38, 0);
  armR.rotation.z = -0.18;
  const foreR = limb(mat, 0.11 * thin, 0.26, 0.12, opts.coat, 0, -0.28, 0.02);
  const handR = meshBox(mat, 0.1, 0.08, 0.1, 0x2a2420);
  handR.position.set(0, -0.28, 0.02);
  foreR.add(handR);
  armR.add(foreR);

  const head = meshBox(mat, 0.2 * thin, 0.22, 0.2, opts.skin);
  head.position.set(0, 1.58, 0.04);
  const hood = meshBox(mat, 0.3 * thin, 0.28, 0.28, opts.coat);
  hood.position.set(0, 1.66, -0.02);
  const brow = meshBox(mat, 0.16 * thin, 0.04, 0.04, shade(opts.skin, 0.55));
  brow.position.set(0, 1.62, 0.14);
  root.add(torso, legL, legR, armL, armR, head, hood, brow);
  if (opts.frost) {
    const rime = meshBox(mat, 0.34, 0.06, 0.22, 0xd5e8ee);
    rime.position.set(0, 1.5, 0.02);
    root.add(rime);
  }
  return { root, torso, legL, legR, armL, armR };
}

function limb(mat: THREE.Material, w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  const mesh = meshBox(mat, w, h, d, color);
  mesh.position.y = -h / 2;
  group.add(mesh);
  return group;
}

function pivot(mat: THREE.Material, w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Group {
  return limb(mat, w, h, d, color, x, y, z);
}

function shade(color: number, gain: number): number {
  const c = new THREE.Color(color);
  c.multiplyScalar(gain);
  return c.getHex();
}
