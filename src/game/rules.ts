export function impactKind(
  dist: number,
  speed: number,
  ramRadius: number,
  ramSpeed: number,
): 'ram' | 'block' | 'none' {
  if (dist > ramRadius) return 'none';
  if (speed >= ramSpeed) return 'ram';
  return 'block';
}

export function environmentFail(
  x: number,
  z: number,
  ditch: { minX: number; maxX: number; minZ: number; maxZ: number },
  bridge: { z0: number; z1: number; half: number },
): 'ditch' | null {
  if (x >= ditch.minX && x <= ditch.maxX && z >= ditch.minZ && z <= ditch.maxZ) return 'ditch';
  if (z >= bridge.z0 && z <= bridge.z1 && Math.abs(x) > bridge.half) return 'ditch';
  return null;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** In-world clock. Chapter 1 starts at 02:17. */
export function formatClock(elapsed: number): string {
  const start = 2 * 3600 + 17 * 60;
  const t = Math.floor(start + elapsed) % 86400;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Yaw 0 faces +Z. In this right-handed frame that view's right is world -X.
 * moveX > 0 is strafe right (D). moveY > 0 is forward (W).
 */
export function planarWish(yaw: number, moveX: number, moveY: number): { x: number; z: number } {
  const forwardX = Math.sin(yaw);
  const forwardZ = Math.cos(yaw);
  const rightX = -forwardZ;
  const rightZ = forwardX;
  return {
    x: forwardX * moveY + rightX * moveX,
    z: forwardZ * moveY + rightZ * moveX,
  };
}

/** Positive amount is a right turn: mouse right, D, or stick right. */
export function steerYaw(yaw: number, amount: number): number {
  return yaw - amount;
}

export function blockedAt(
  x: number,
  z: number,
  r: number,
  boxes: { minX: number; maxX: number; minZ: number; maxZ: number }[],
): boolean {
  for (const box of boxes) {
    const cx = Math.max(box.minX, Math.min(x, box.maxX));
    const cz = Math.max(box.minZ, Math.min(z, box.maxZ));
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}
