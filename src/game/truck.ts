import * as THREE from 'three';
import { createBeam, emissiveMaterial, meshBox, paint } from '../render/night';
import { resolveCircle } from './collide';
import type { AABB } from './layout';
import { steerYaw } from './rules';
import { TUNE } from './tune';

export class Truck {
  x = 0;
  z = 12;
  yaw = 0;
  speed = 0;
  engine: 'idle' | 'drive' | 'off' = 'idle';
  drivable = true;
  readonly group = new THREE.Group();
  readonly beam: THREE.Mesh;
  private readonly glow: THREE.ShaderMaterial;

  constructor(parent: THREE.Object3D, mat: THREE.Material) {
    this.group.name = 'power-truck';
    const body = meshBox(mat, 1.85, 0.46, 3.9, 0x2a3830);
    body.position.set(0, 0.48, 0.05);
    const cab = meshBox(mat, 1.65, 0.58, 1.25, 0x1c2822);
    cab.position.set(0, 1.02, -0.7);
    const bed = meshBox(mat, 1.7, 0.26, 1.45, 0x1a221c);
    bed.position.set(0, 0.72, -1.45);
    const glass = meshBox(mat, 1.45, 0.05, 0.04, 0x141a20);
    glass.position.set(0, 1.32, 0.05);
    this.group.add(body, cab, bed, glass);
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10);
    paint(wheelGeo, new THREE.Color(0x1a1c1e));
    for (const side of [-1, 1]) {
      for (const z of [1.35, -1.35]) {
        const wheel = new THREE.Mesh(wheelGeo, mat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 0.85, 0.32, z);
        this.group.add(wheel);
      }
      const lamp = meshBox(mat, 0.18, 0.12, 0.08, 0xffe2b0);
      lamp.position.set(side * 0.55, 0.62, 2.08);
      this.group.add(lamp);
    }
    this.glow = emissiveMaterial(0xffe2b0, 2.4);
    for (const side of [-1, 1]) {
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.04), this.glow);
      glow.position.set(side * 0.55, 0.62, 2.12);
      this.group.add(glow);
    }
    this.beam = createBeam();
    this.beam.position.set(0, 0.66, 2.05);
    this.beam.rotation.y = Math.PI;
    this.beam.scale.set(1.35, 1.35, 16);
    this.group.add(this.beam);
    parent.add(this.group);
    this.sync();
  }

  local(lx: number, ly: number, lz: number): { x: number; y: number; z: number } {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return {
      x: this.x + lx * c + lz * s,
      y: ly,
      z: this.z - lx * s + lz * c,
    };
  }

  seat(): { x: number; y: number; z: number } {
    return this.local(-0.38, 1.52, 0.42);
  }

  door(): { x: number; z: number } {
    const p = this.local(-1.7, 0, 0.25);
    return { x: p.x, z: p.z };
  }

  bed(): { x: number; z: number } {
    const p = this.local(0.85, 0, -2.25);
    return { x: p.x, z: p.z };
  }

  bumper(): { x: number; z: number } {
    const p = this.local(0, 0.7, 2.35);
    return { x: p.x, z: p.z };
  }

  circles(): { x: number; z: number; r: number }[] {
    return [-1.35, 0.2, 1.5].map((lz) => {
      const p = this.local(0, 0, lz);
      return { x: p.x, z: p.z, r: 0.92 };
    });
  }

  step(dt: number, throttle: number, steer: number, solids: AABB[]): void {
    if (this.drivable && this.engine !== 'off') {
      if (throttle > 0.05) {
        this.speed += 6.8 * dt * throttle;
        this.engine = 'drive';
      } else if (throttle < -0.05) {
        this.speed -= 4.4 * dt;
        this.engine = 'drive';
      } else {
        this.speed *= Math.max(0, 1 - 1.5 * dt);
        if (Math.abs(this.speed) < 0.12) {
          this.speed = 0;
          this.engine = 'idle';
        }
      }
      this.speed = Math.max(-3, Math.min(TUNE.truckMax, this.speed));
      const turn = (0.4 + 0.9 * Math.min(1, Math.abs(this.speed) / 5)) * Math.sign(this.speed || 1);
      this.yaw = steerYaw(this.yaw, steer * turn * dt);
    } else {
      this.speed *= Math.max(0, 1 - 2.4 * dt);
      if (Math.abs(this.speed) < 0.05) this.speed = 0;
    }
    this.integrate(dt, solids);
  }

  slide(dt: number, yawRate: number, solids: AABB[]): void {
    this.yaw += yawRate * dt;
    this.speed = Math.max(0, this.speed - 3.4 * dt);
    this.integrate(dt, solids);
  }

  kill(): void {
    this.engine = 'off';
    this.drivable = false;
    this.speed = 0;
  }

  setHead(on: boolean): void {
    this.beam.visible = on;
    this.glow.uniforms.uGain.value = on ? 1.35 : 0.02;
  }

  sync(): void {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.yaw;
  }

  private integrate(dt: number, solids: AABB[]): void {
    let x = this.x + Math.sin(this.yaw) * this.speed * dt;
    let z = this.z + Math.cos(this.yaw) * this.speed * dt;
    const body = resolveCircle(x, z, TUNE.truckRadius, solids, []);
    if (body.hit) this.speed *= 0.3;
    const fx = body.x + Math.sin(this.yaw) * 2.15;
    const fz = body.z + Math.cos(this.yaw) * 2.15;
    const nose = resolveCircle(fx, fz, 0.5, solids, []);
    if (nose.hit) {
      this.speed *= 0.25;
      x = body.x + (nose.x - fx);
      z = body.z + (nose.z - fz);
    } else {
      x = body.x;
      z = body.z;
    }
    this.x = x;
    this.z = z;
  }
}
