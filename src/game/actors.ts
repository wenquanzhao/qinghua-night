import * as THREE from 'three';
import { buildWinterFigure } from './figure';
import { resolveCircle } from './collide';
import type { AABB } from './layout';
import { TUNE } from './tune';

export class Fever {
  x: number;
  z: number;
  hp = TUNE.enemyHp;
  down = false;
  rising = false;
  downT = 0;
  aggro = false;
  manual = false;
  wake: number;
  line: string;
  said = false;
  yaw = 0;
  private phase: 'idle' | 'wind' = 'idle';
  private timer = 0;
  private cool = 0;
  private walk = 0;
  readonly root: THREE.Group;
  private readonly torso: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;

  constructor(parent: THREE.Object3D, mat: THREE.Material, x: number, z: number, coat: number, line: string, wake: number) {
    this.x = x;
    this.z = z;
    this.line = line;
    this.wake = wake;
    this.yaw = Math.PI;
    const fig = buildWinterFigure(mat, { coat, skin: 0xc4b6aa, scarf: 0x6a3030 });
    this.root = fig.root;
    this.torso = fig.torso;
    this.legL = fig.legL;
    this.legR = fig.legR;
    this.armL = fig.armL;
    this.armR = fig.armR;
    this.root.position.set(x, 0, z);
    parent.add(this.root);
  }

  /** Ram knockdown. They get back up; damage is ignored until then. */
  knock(seconds: number): void {
    this.down = true;
    this.rising = true;
    this.downT = seconds;
    this.aggro = false;
    this.phase = 'idle';
  }

  hurt(amount: number): 'none' | 'stun' | 'down' {
    if (this.rising || this.down) return 'none';
    this.hp -= amount;
    this.cool = 0.4;
    this.phase = 'idle';
    if (this.hp <= 0) {
      this.down = true;
      this.rising = false;
      return 'down';
    }
    return 'stun';
  }

  update(dt: number, px: number, pz: number, onFoot: boolean, solids: AABB[]): boolean {
    if (this.manual && !this.aggro) {
      this.tickDown(dt);
      this.pose(dt, false);
      this.root.position.set(this.x, this.down ? 0.28 : 0, this.z);
      this.root.rotation.set(0, this.yaw, this.down ? 1.15 : 0);
      return false;
    }
    if (this.down) {
      this.tickDown(dt);
      this.pose(dt, false);
      this.root.position.set(this.x, 0.28, this.z);
      this.root.rotation.set(0, this.yaw, 1.15);
      return false;
    }
    const dx = px - this.x;
    const dz = pz - this.z;
    const dist = Math.hypot(dx, dz) || 0.0001;
    if (!this.aggro) {
      if (onFoot && dist < this.wake) this.aggro = true;
      this.pose(dt, false);
      this.root.position.set(this.x, 0, this.z);
      this.root.rotation.y = this.yaw;
      return false;
    }
    this.yaw = Math.atan2(dx, dz);
    let hit = false;
    this.cool -= dt;
    if (this.phase === 'wind') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = 'idle';
        this.cool = 1.15;
        if (dist < 1.85) hit = true;
      }
    } else if (dist < 1.6 && this.cool <= 0) {
      this.phase = 'wind';
      this.timer = 0.52;
    } else if (dist > 1.15) {
      const burst = Math.sin(this.walk * 1.3) > 0.72 ? 2.35 : 1.15;
      this.x += (dx / dist) * burst * dt;
      this.z += (dz / dist) * burst * dt;
      if (this.z > 192 && this.z < 216) this.x = Math.max(-2.2, Math.min(2.2, this.x));
      else this.x = Math.max(-5.4, Math.min(5.4, this.x));
      const pushed = resolveCircle(this.x, this.z, 0.34, solids, []);
      this.x = pushed.x;
      this.z = pushed.z;
    }
    this.pose(dt, this.phase !== 'wind' && dist > 1.15);
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.set(0, this.yaw, 0);
    return hit;
  }

  private tickDown(dt: number): void {
    if (!this.rising) return;
    this.downT -= dt;
    if (this.downT <= 0 && this.hp > 0) {
      this.down = false;
      this.rising = false;
      this.aggro = true;
      this.manual = false;
    }
  }

  private pose(dt: number, moving: boolean): void {
    this.walk += dt * (moving ? 6.5 : 1.4);
    const swing = moving ? Math.sin(this.walk) * 0.55 : Math.sin(this.walk) * 0.04;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.6;
    this.armR.rotation.x = swing * 0.6;
    this.torso.rotation.x = this.phase === 'wind' ? -0.4 : Math.sin(this.walk * 0.5) * 0.03;
    this.torso.rotation.z = Math.sin(this.walk * 0.7) * (moving ? 0.06 : 0.02);
  }
}

