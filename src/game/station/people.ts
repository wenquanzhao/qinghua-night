import * as THREE from 'three';
import { buildWinterFigure } from '../figure';
import { resolveCircle } from '../collide';
import type { AABB } from '../layout';

export interface Hazard {
  x: number;
  z: number;
  r: number;
}

interface Body {
  root: THREE.Group;
  torso: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
}

export class Colleague {
  x: number;
  z: number;
  yaw = 0;
  hp = 72;
  down = false;
  rising = false;
  bound = false;
  aggro = false;
  downT = 0;
  wake: number;
  readonly root: THREE.Group;
  private readonly body: Body;
  private phase: 'idle' | 'wind' = 'idle';
  private timer = 0;
  private cool = 0;
  private walk = 0;

  constructor(parent: THREE.Object3D, mat: THREE.Material, x: number, z: number, badge: boolean, wake: number) {
    this.x = x;
    this.z = z;
    this.wake = wake;
    this.body = buildPerson(mat, 0x5c6e78, 0xd2c4b6, badge);
    this.root = this.body.root;
    this.root.position.set(x, 0, z);
    parent.add(this.root);
  }

  knock(seconds: number): void {
    if (this.bound) return;
    this.down = true;
    this.rising = true;
    this.downT = seconds;
    this.phase = 'idle';
  }

  hurt(amount: number): 'none' | 'stun' | 'down' {
    if (this.bound || this.down) return 'none';
    this.hp -= amount;
    this.cool = 0.35;
    this.phase = 'idle';
    if (this.hp > 0) return 'stun';
    this.hp = 0;
    this.down = true;
    this.rising = true;
    this.downT = 8;
    return 'down';
  }

  bind(x: number, z: number, yaw: number): void {
    this.bound = true;
    this.down = true;
    this.rising = false;
    this.aggro = false;
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.hp = 0;
  }

  blocks(): boolean {
    return !this.bound && !this.down;
  }

  update(dt: number, px: number, pz: number, solids: AABB[]): boolean {
    if (this.bound) {
      this.pose(dt, false, true);
      this.root.position.set(this.x, 0.42, this.z);
      this.root.rotation.set(0.15, this.yaw, 0);
      return false;
    }
    if (this.down) {
      this.downT -= dt;
      if (this.rising && this.downT <= 0) {
        this.down = false;
        this.rising = false;
        this.hp = 48;
        this.aggro = true;
      }
      this.pose(dt, false, false);
      this.root.position.set(this.x, 0.28, this.z);
      this.root.rotation.set(0, this.yaw, 1.2);
      return false;
    }
    const dx = px - this.x;
    const dz = pz - this.z;
    const dist = Math.hypot(dx, dz) || 0.0001;
    if (!this.aggro && dist < this.wake) this.aggro = true;
    if (!this.aggro) {
      this.pose(dt, false, false);
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
        this.cool = 1.2;
        if (dist < 1.7) hit = true;
      }
    } else if (dist < 1.45 && this.cool <= 0) {
      this.phase = 'wind';
      this.timer = 0.48;
    } else if (dist > 1.05) {
      const burst = Math.sin(this.walk * 1.7) > 0.55 ? 2.05 : 1.15;
      this.step((dx / dist) * burst * dt, (dz / dist) * burst * dt, solids);
    }
    this.pose(dt, this.phase !== 'wind' && dist > 1.05, false);
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.set(0, this.yaw, 0);
    return hit;
  }

  private step(dx: number, dz: number, solids: AABB[]): void {
    const next = resolveCircle(this.x + dx, this.z + dz, 0.36, solids, []);
    this.x = next.x;
    this.z = next.z;
  }

  private pose(dt: number, moving: boolean, seated: boolean): void {
    this.walk += dt * (moving ? 5.5 : 1.2);
    const swing = moving ? Math.sin(this.walk) * 0.45 : 0;
    this.body.legL.rotation.x = seated ? 1.15 : swing;
    this.body.legR.rotation.x = seated ? 1.15 : -swing;
    this.body.armL.rotation.x = seated ? 0.4 : -swing * 0.5;
    this.body.armR.rotation.x = this.phase === 'wind' ? -1.1 : swing * 0.5;
    this.body.torso.rotation.x = seated ? 0.25 : this.phase === 'wind' ? -0.35 : 0;
  }
}

export class Stiff {
  x: number;
  z: number;
  yaw = 0;
  down = false;
  downT = 0;
  readonly root: THREE.Group;
  private readonly body: Body;
  private phase: 'idle' | 'wind' = 'idle';
  private timer = 0;
  private cool = 0.4;
  private walk = 0;

  constructor(parent: THREE.Object3D, mat: THREE.Material, x: number, z: number) {
    this.x = x;
    this.z = z;
    this.body = buildPerson(mat, 0x3e4c56, 0xb7c8d0, false, true);
    this.root = this.body.root;
    this.root.position.set(x, 0, z);
    parent.add(this.root);
  }

  blocks(): boolean {
    return !this.down;
  }

  knock(seconds: number): void {
    this.down = true;
    this.downT = seconds;
    this.phase = 'idle';
  }

  hurt(amount: number): 'none' | 'stun' | 'down' {
    void amount;
    if (this.down) return 'none';
    this.knock(2.35);
    return 'down';
  }

  update(
    dt: number,
    px: number,
    pz: number,
    aimX: number,
    aimZ: number,
    lightOn: boolean,
    fearDot: number,
    hazards: Hazard[],
    solids: AABB[],
  ): boolean {
    for (const hazard of hazards) {
      const dx = this.x - hazard.x;
      const dz = this.z - hazard.z;
      const dist = Math.hypot(dx, dz);
      if (dist < hazard.r) {
        const len = dist || 0.001;
        this.knock(2.5);
        const next = resolveCircle(this.x + (dx / len) * 1.3, this.z + (dz / len) * 1.3, 0.36, solids, []);
        this.x = next.x;
        this.z = next.z;
      }
    }
    if (this.down) {
      this.downT -= dt;
      if (this.downT <= 0) this.down = false;
      this.root.position.set(this.x, 0.26, this.z);
      this.root.rotation.set(0, this.yaw, 1.25);
      return false;
    }
    const dx = px - this.x;
    const dz = pz - this.z;
    const dist = Math.hypot(dx, dz) || 0.0001;
    const afraid = lightOn && (dx / dist) * aimX + (dz / dist) * aimZ > fearDot && dist < 15;
    this.yaw = Math.atan2(dx, dz);
    let hit = false;
    if (afraid) {
      this.phase = 'idle';
      const next = resolveCircle(this.x - (dx / dist) * 2.5 * dt, this.z - (dz / dist) * 2.5 * dt, 0.36, solids, []);
      this.x = next.x;
      this.z = next.z;
    } else {
      this.cool -= dt;
      if (this.phase === 'wind') {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'idle';
          this.cool = 0.95;
          if (dist < 1.65) hit = true;
        }
      } else if (dist < 1.4 && this.cool <= 0) {
        this.phase = 'wind';
        this.timer = 0.36;
      } else if (dist > 0.95) {
        const next = resolveCircle(this.x + (dx / dist) * 3.55 * dt, this.z + (dz / dist) * 3.55 * dt, 0.36, solids, []);
        this.x = next.x;
        this.z = next.z;
      }
    }
    this.walk += dt * 7;
    const swing = afraid ? 0 : Math.sin(this.walk) * 0.7;
    this.body.legL.rotation.x = swing;
    this.body.legR.rotation.x = -swing;
    this.body.armL.rotation.x = -0.8;
    this.body.armR.rotation.x = this.phase === 'wind' ? -1.3 : -0.7;
    this.body.torso.rotation.x = afraid ? 0.2 : 0.15;
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.set(0, this.yaw, 0);
    return hit;
  }
}

function buildPerson(mat: THREE.Material, cloth: number, skin: number, badge: boolean, stiff = false): Body {
  return buildWinterFigure(mat, {
    coat: cloth,
    skin,
    badge,
    frost: stiff,
    thin: stiff,
    pants: stiff ? 0x2a3338 : 0x241c1a,
    scarf: stiff ? 0x6e7c84 : 0x6a3030,
  });
}
