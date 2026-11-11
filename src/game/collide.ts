import type { AABB } from './layout';

export function circleHits(x: number, z: number, r: number, box: AABB): boolean {
  const cx = Math.max(box.minX, Math.min(x, box.maxX));
  const cz = Math.max(box.minZ, Math.min(z, box.maxZ));
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

export function pushCircle(
  x: number,
  z: number,
  r: number,
  box: AABB,
): { x: number; z: number; hit: boolean } {
  const cx = Math.max(box.minX, Math.min(x, box.maxX));
  const cz = Math.max(box.minZ, Math.min(z, box.maxZ));
  let dx = x - cx;
  let dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return { x, z, hit: false };
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    const push = r - d + 0.001;
    return { x: x + (dx / d) * push, z: z + (dz / d) * push, hit: true };
  }
  const left = x - box.minX;
  const right = box.maxX - x;
  const near = z - box.minZ;
  const far = box.maxZ - z;
  const m = Math.min(left, right, near, far);
  if (m === left) return { x: box.minX - r - 0.01, z, hit: true };
  if (m === right) return { x: box.maxX + r + 0.01, z, hit: true };
  if (m === near) return { x, z: box.minZ - r - 0.01, hit: true };
  return { x, z: box.maxZ + r + 0.01, hit: true };
}

export function pushCircleCircle(
  x: number,
  z: number,
  r: number,
  cx: number,
  cz: number,
  cr: number,
): { x: number; z: number; hit: boolean } {
  let dx = x - cx;
  let dz = z - cz;
  const min = r + cr;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return { x, z, hit: false };
  const d = Math.sqrt(d2) || 0.0001;
  const push = min - d + 0.001;
  return { x: x + (dx / d) * push, z: z + (dz / d) * push, hit: true };
}

export function resolveCircle(
  x: number,
  z: number,
  r: number,
  boxes: AABB[],
  circles: { x: number; z: number; r: number }[],
): { x: number; z: number; hit: boolean } {
  let hit = false;
  for (let n = 0; n < 3; n++) {
    for (const box of boxes) {
      const p = pushCircle(x, z, r, box);
      if (p.hit) {
        x = p.x;
        z = p.z;
        hit = true;
      }
    }
    for (const c of circles) {
      const p = pushCircleCircle(x, z, r, c.x, c.z, c.r);
      if (p.hit) {
        x = p.x;
        z = p.z;
        hit = true;
      }
    }
  }
  return { x, z, hit };
}
