import { resolveCircle } from './collide';
import type { AABB } from './layout';
import { planarWish } from './rules';
import { TUNE } from './tune';

/** On-foot body. Chapter 2 can reuse this without the truck. */
export class FootMover {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  vy = 0;
  vx = 0;
  vz = 0;
  crouch = 0;
  wantCrouch = false;
  grounded = true;

  eye(): number {
    return TUNE.eye - this.crouch * TUNE.crouchDrop + this.y;
  }

  update(
    dt: number,
    moveX: number,
    moveY: number,
    sprint: boolean,
    jump: boolean,
    boxes: AABB[],
    circles: { x: number; z: number; r: number }[],
    icy: boolean,
    locked: boolean,
  ): void {
    const target = this.wantCrouch ? 1 : 0;
    this.crouch += (target - this.crouch) * Math.min(1, dt * 8);
    if (locked) {
      this.vx *= Math.max(0, 1 - 6 * dt);
      this.vz *= Math.max(0, 1 - 6 * dt);
      this.y += this.vy * dt;
      return;
    }
    const speed = this.wantCrouch ? TUNE.crouch : sprint ? TUNE.sprint : TUNE.walk;
    const wish = planarWish(this.yaw, moveX, moveY);
    const wishX = wish.x * speed;
    const wishZ = wish.z * speed;
    const k = icy ? 2.4 : 16;
    this.vx += (wishX - this.vx) * Math.min(1, dt * k);
    this.vz += (wishZ - this.vz) * Math.min(1, dt * k);
    if (jump && this.grounded && this.crouch < 0.4) {
      this.vy = TUNE.jumpV;
      this.grounded = false;
    }
    this.vy -= TUNE.gravity * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) {
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
    }
    const next = resolveCircle(this.x + this.vx * dt, this.z + this.vz * dt, TUNE.footRadius, boxes, circles);
    if (next.hit) {
      this.vx *= 0.4;
      this.vz *= 0.4;
    }
    this.x = next.x;
    this.z = next.z;
  }
}
