import * as THREE from 'three';
import { Fever } from '../actors';
import { LAYOUT, worldSolids, fenceSolids, staticSolids, type AABB } from '../layout';
import { FootMover } from '../player';
import { environmentFail, impactKind, steerYaw } from '../rules';
import { Truck } from '../truck';
import { TUNE } from '../tune';
import type { Chapter, Host, Objective, Report } from '../types';
import {
  createBeam,
  createLitMaterial,
  emissiveMaterial,
  meshBox,
  paint,
  signMaterial,
  tagMode,
  windowMaterial,
} from '../../render/night';

interface Spot {
  id: string;
  pos: () => { x: number; z: number };
  label: string;
  time: number;
  /** Single press. World searches and doors stay hold-to-use. */
  tap?: boolean;
  ok: () => boolean;
  run: () => void;
}

export class HighwayChapter implements Chapter {
  private readonly root = new THREE.Group();
  private readonly foot = new FootMover();
  private readonly lit: THREE.ShaderMaterial;
  private readonly truck: Truck;
  private readonly coat: Fever;
  private readonly enemies: Fever[];
  private readonly objectives: Objective[] = [
    { id: 'road', text: '沿县道到南岸变电站大门', done: false },
    { id: 'radio', text: '用警车对讲机联络青台', done: false },
    { id: 'enter', text: '扳开铁门或从检修门进去', done: false },
  ];
  private view!: THREE.Group;
  private barMesh!: THREE.Object3D;
  private gunMesh!: THREE.Object3D;
  private lampMat!: THREE.ShaderMaterial;
  private flashBeam!: THREE.Mesh;
  private gateL!: THREE.Group;
  private gateR!: THREE.Group;
  private sideDoor!: THREE.Group;
  private policeRed!: THREE.ShaderMaterial;
  private policeBlue!: THREE.ShaderMaterial;
  private readonly textures: THREE.Texture[] = [];

  private riding = true;
  private cab = 0;
  private pitch = -0.08;
  private health: number = TUNE.health;
  private hasFlash = false;
  private flashOn = false;
  private hasBar = false;
  private hasGun = false;
  private ammoIn = 0;
  private ammoRes = 0;
  private weapon: 'hands' | 'bar' | 'gun' = 'hands';
  private reloadT = 0;
  private meleeCd = 0;
  private invuln = 0;
  private kick = 0;
  private shake = 0;
  private bob = 0;
  private bobAmt = 0;
  private t = 0;
  private mode: 'play' | 'fail' | 'end' = 'play';
  private failKind: 'down' | 'ditch' = 'down';
  private failT = 0;
  private failReady = false;
  private endT = 0;
  private complete = false;
  private lootedTruck = false;
  private lootedPolice = false;
  private gateOpen = false;
  private sideOpen = false;
  private rammed = false;
  private stalling = false;
  private stallT = 0;
  private stallYaw = 0;
  private flicker = 0;
  private coatState = 'wait';
  private coatTimer = 0;
  private coatSaid = false;
  private holdId: string | null = null;
  private hold = 0;
  private prompt = '';
  private promptHold = -1;
  private toldHurt = false;
  private driveHint = false;
  private footHint = false;
  private policeHint = false;
  private flashHint = false;
  private footTick = 0;

  constructor(private readonly host: Host) {
    this.lit = createLitMaterial(host.night);
    this.truck = new Truck(this.root, this.lit);
    this.truck.x = LAYOUT.truckStart.x;
    this.truck.z = LAYOUT.truckStart.z;
    this.coat = new Fever(this.root, this.lit, LAYOUT.coat.x, LAYOUT.coat.z, 0x6a5a48, '冷', 5);
    this.coat.manual = true;
    const colors = [0x3e4650, 0x4a3c38, 0x323844];
    this.enemies = [
      this.coat,
      ...LAYOUT.enemies.map((spot, index) => new Fever(this.root, this.lit, spot.x, spot.z, colors[index] ?? 0x3e4650, spot.line, spot.wake)),
    ];
  }

  mount(): void {
    this.host.scene.add(this.root);
    this.buildWorld();
    this.buildView();
    this.truck.sync();
    const seat = this.truck.seat();
    this.foot.x = seat.x;
    this.foot.z = seat.z;
    this.foot.yaw = this.truck.yaw;
    this.visuals(0);
  }

  dispose(): void {
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (!material || material === this.lit) return;
      const list = Array.isArray(material) ? material : [material];
      for (const entry of list) entry.dispose();
    });
    this.view?.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.flashBeam?.geometry.dispose();
    (this.flashBeam?.material as THREE.Material | undefined)?.dispose();
    this.lampMat?.dispose();
    this.lit.dispose();
    for (const tex of this.textures) tex.dispose();
    this.host.scene.remove(this.root);
    this.view?.removeFromParent();
    this.flashBeam?.removeFromParent();
    this.host.night.zero();
  }

  present(dt: number): void {
    this.t += dt;
    this.visuals(dt);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.mode === 'fail') {
      this.failT -= dt;
      this.pitch = Math.max(-1.1, this.pitch - dt);
      this.foot.pitch = Math.max(-1.1, this.foot.pitch - dt);
      if (this.failKind === 'ditch') this.foot.y -= dt * 0.9;
      if (this.failT <= 0) this.failReady = true;
      this.visuals(dt);
      return;
    }
    if (this.mode === 'end') {
      this.endT -= dt;
      if (this.endT <= 0) this.complete = true;
      this.visuals(dt);
      return;
    }
    const snap = this.host.input.snapshot(dt);
    this.applyLook(snap.lookX, snap.lookY);
    this.kick *= Math.max(0, 1 - 8 * dt);
    if (this.riding) this.pitch = clamp(this.pitch + this.kick, -0.55, 0.42);
    else this.foot.pitch = clamp(this.foot.pitch + this.kick, -1.15, 1.15);
    this.shake = Math.max(0, this.shake - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    if (this.flicker > 0) this.flicker = Math.max(0, this.flicker - dt);
    const solids = worldSolids(this.gateOpen, this.sideOpen);
    if (this.riding) this.drive(dt, snap.moveY, snap.moveX, solids);
    else this.walk(dt, snap, solids);
    this.updateCoat(dt);
    let spoke = false;
    for (const enemy of this.enemies) {
      const hit = enemy.update(dt, this.foot.x, this.foot.z, !this.riding, solids);
      if (hit && !this.riding) this.hurt(TUNE.biteDamage);
      if (!spoke && enemy !== this.coat && enemy.aggro && !enemy.said && !this.host.busy()) {
        enemy.said = true;
        spoke = true;
        this.host.say('路人', enemy.line, 1.2);
      }
    }
    this.separateEnemies();
    this.updateInteract(dt, snap.interact, snap.interactPressed);
    this.handleGear(snap);
    this.tickReload(dt);
    this.checkWorld();
    this.checkGate();
    if (this.foot.z > 250 || this.truck.z > 250) this.mark('road');
    if (!this.driveHint && this.riding) {
      this.driveHint = true;
      this.host.hint('W 前进 · A D 转向 · 按 E 下车', 4.5);
    }
    this.visuals(dt);
  }

  report(): Report {
    const z = this.riding ? this.truck.z : this.foot.z;
    const x = this.riding ? this.truck.x : this.foot.x;
    return {
      primary: this.primary(),
      objectives: this.objectives.map((item) => ({ ...item })),
      health: this.health,
      weapon: this.weapon === 'gun' ? '手枪' : this.weapon === 'bar' ? '撬棍' : '徒手',
      ammoIn: this.ammoIn,
      ammoReserve: this.ammoRes,
      showAmmo: this.hasGun,
      lightOn: this.flashOn && this.hasFlash,
      prompt: this.prompt,
      hold: this.promptHold,
      riding: this.riding,
      fail: this.failReady ? this.failKind : null,
      complete: this.complete,
      crosshair: !this.riding && this.mode === 'play',
      debug: `${this.riding ? '车' : '步'} ${x.toFixed(1)} ${z.toFixed(1)} ${this.coatState}`,
    };
  }

  private primary(): string {
    if (this.complete || this.mode === 'end') return '外门开了';
    if (this.foot.z > 246 || this.truck.z > 246) return '扳开铁门，或从侧面检修门进去';
    return '沿县道到南岸变电站大门';
  }

  private drive(dt: number, throttle: number, steer: number, solids: AABB[]): void {
    if (this.stalling) {
      this.stallT -= dt;
      this.truck.slide(dt, this.stallYaw, solids);
      if (this.stallT <= 0) {
        this.stalling = false;
        this.truck.kill();
        this.flicker = 0.6;
      }
    } else if (this.truck.drivable && this.truck.z > LAYOUT.ice.z0) {
      this.stalling = true;
      this.stallT = 1.25;
      this.stallYaw = (Math.random() * 2 - 1) * 0.5;
      this.truck.speed = Math.max(this.truck.speed, 4.2);
      this.truck.drivable = false;
      this.host.audio.stall();
      this.host.hint('结冰，熄火了。', 2.4);
      this.truck.slide(dt, this.stallYaw, solids);
    } else {
      this.truck.step(dt, throttle, steer, solids);
      this.resolveCoat();
    }
    const seat = this.truck.seat();
    this.foot.x = seat.x;
    this.foot.z = seat.z;
    this.foot.y = 0;
  }

  private resolveCoat(): void {
    if (this.coat.hp <= 0 || this.coat.down || this.rammed) return;
    const dx = this.truck.x - this.coat.x;
    const dz = this.truck.z - this.coat.z;
    const dist = Math.hypot(dx, dz);
    const kind = impactKind(dist, this.truck.speed, TUNE.ramRadius, TUNE.ramSpeed);
    if (kind === 'ram') {
      this.rammed = true;
      this.truck.kill();
      this.flicker = 0.85;
      this.coat.knock(4);
      const c = Math.cos(this.truck.yaw);
      const s = Math.sin(this.truck.yaw);
      this.coat.x += c * 1.5;
      this.coat.z += -s * 1.5;
      this.coatState = 'combat';
      this.host.audio.thud();
      this.host.audio.stall();
      this.shake = 0.45;
      this.host.hint('车撞坏了。下来吧，车里有手电和撬棍。', 4.2);
      return;
    }
    if (kind === 'block') {
      const len = dist || 0.001;
      this.truck.x = this.coat.x + (dx / len) * (TUNE.ramRadius + 0.08);
      this.truck.z = this.coat.z + (dz / len) * (TUNE.ramRadius + 0.08);
      this.truck.speed = 0;
    }
  }

  private walk(dt: number, snap: { moveX: number; moveY: number; sprint: boolean; jump: boolean; crouch: boolean }, solids: AABB[]): void {
    this.foot.wantCrouch = snap.crouch;
    const icy = this.foot.z >= LAYOUT.ice.z0 && this.foot.z <= LAYOUT.ice.z1;
    this.foot.update(dt, snap.moveX, snap.moveY, snap.sprint, snap.jump, solids, this.truck.circles(), icy, false);
    const speed = Math.hypot(this.foot.vx, this.foot.vz);
    this.bob += dt * speed * 1.8;
    this.bobAmt = this.foot.grounded ? Math.min(1, speed / 3) : 0;
    if (this.foot.grounded && speed > 1.2) {
      this.footTick -= dt;
      if (this.footTick <= 0) {
        this.footTick = snap.sprint ? 0.32 : 0.46;
        this.host.audio.foot();
      }
    }
  }

  private updateCoat(dt: number): void {
    const enemy = this.coat;
    if (enemy.hp <= 0 || this.rammed) return;
    const dist = Math.hypot(enemy.x - this.foot.x, enemy.z - this.foot.z);
    const speed = this.truck.speed;
    if (this.coatState === 'wait') {
      enemy.manual = true;
      enemy.yaw = Math.atan2(this.foot.x - enemy.x, this.foot.z - enemy.z);
      if (!this.riding && dist < 4.2) this.beginMurmur(0.65);
      else if (this.riding && dist < 7.5 && speed < 1.15 && speed > -0.2) this.beginMurmur(0.85);
      else if (this.riding && this.truck.z > enemy.z + 4.5 && speed > 2) this.coatState = 'watch';
    } else if (this.coatState === 'murmur') {
      enemy.yaw = Math.atan2(this.foot.x - enemy.x, this.foot.z - enemy.z);
      this.coatTimer -= dt;
      if (this.coatTimer > 0) return;
      if (this.riding && dist < 6 && speed < 2.4) {
        this.coatState = 'door';
        this.coatTimer = 0.6;
      } else if (!this.riding) this.enterCombat();
      else this.coatState = 'watch';
    } else if (this.coatState === 'door') {
      const door = this.truck.door();
      const dx = door.x - enemy.x;
      const dz = door.z - enemy.z;
      const len = Math.hypot(dx, dz) || 1;
      enemy.x += (dx / len) * 2.2 * dt;
      enemy.z += (dz / len) * 2.2 * dt;
      enemy.yaw = Math.atan2(dx, dz);
      if (!this.riding) {
        this.enterCombat();
        return;
      }
      if (speed > 3.5) {
        this.coatState = 'watch';
        this.host.hint('人被甩在后面。', 1.8);
        return;
      }
      this.coatTimer -= dt;
      if (this.coatTimer <= 0) {
        if (speed < 2.6 && dist < 4.8) {
          this.hurt(TUNE.doorDamage);
          this.host.audio.thud();
          this.host.hint('扑上车门了。油门还能走。', 3);
          this.coatTimer = 2.6;
        } else this.coatState = 'watch';
      }
    } else if (this.coatState === 'watch' && !this.riding && dist < 14) this.enterCombat();
  }

  private beginMurmur(time: number): void {
    this.coatState = 'murmur';
    this.coatTimer = time;
    if (!this.coatSaid) {
      this.coatSaid = true;
      this.coat.said = true;
      this.host.say('路人', '冷', 1.3);
      this.host.audio.breath();
    }
  }

  private enterCombat(): void {
    this.coatState = 'combat';
    this.coat.manual = false;
    this.coat.aggro = true;
  }

  private updateInteract(dt: number, held: boolean, pressed: boolean): void {
    if (this.riding && !this.stalling && Math.abs(this.truck.speed) >= 1.35) {
      this.hold = 0;
      this.holdId = null;
      this.prompt = held || pressed ? '减速后按 E 下车' : '';
      this.promptHold = -1;
      return;
    }
    const spot = this.pickSpot();
    if (!spot) {
      this.hold = 0;
      this.holdId = null;
      this.prompt = '';
      this.promptHold = -1;
      return;
    }
    if (spot.tap) {
      this.hold = 0;
      this.holdId = spot.id;
      this.prompt = spot.label;
      this.promptHold = -1;
      if (pressed) spot.run();
      return;
    }
    if (!held) {
      this.hold = 0;
      this.holdId = spot.id;
      this.prompt = spot.label;
      this.promptHold = 0;
      return;
    }
    if (this.holdId !== spot.id) {
      this.holdId = spot.id;
      this.hold = 0;
    }
    this.hold += dt;
    this.prompt = spot.label;
    this.promptHold = Math.min(1, this.hold / spot.time);
    if (this.hold >= spot.time) {
      this.hold = 0;
      this.holdId = null;
      spot.run();
    }
  }

  private pickSpot(): Spot | null {
    const spots = this.spots().filter((spot) => spot.ok());
    if (this.riding) return spots.find((spot) => spot.id === 'exit') ?? null;
    const yaw = this.foot.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    let best: Spot | null = null;
    let bestD = 2.45;
    for (const spot of spots) {
      const pos = spot.pos();
      const dx = pos.x - this.foot.x;
      const dz = pos.z - this.foot.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 2.4) continue;
      const dot = dist < 0.001 ? 1 : (dx / dist) * fx + (dz / dist) * fz;
      if (dot < 0.15 && dist > 1.35) continue;
      if (dist < bestD) {
        best = spot;
        bestD = dist;
      }
    }
    return best;
  }

  private spots(): Spot[] {
    const truck = this.truck;
    if (this.riding) {
      return [{
        id: 'exit',
        pos: () => ({ x: truck.x, z: truck.z }),
        label: '按 E 下车',
        time: 0,
        tap: true,
        ok: () => Math.abs(truck.speed) < 1.35 && !this.stalling,
        run: () => this.exitTruck(),
      }];
    }
    return [
      {
        id: 'enter',
        pos: () => truck.door(),
        label: '按 E 上车',
        time: 0,
        tap: true,
        ok: () => truck.drivable,
        run: () => this.enterTruck(),
      },
      {
        id: 'loot-truck',
        pos: () => truck.bed(),
        label: '按住 E · 搜寻车里',
        time: 0.7,
        ok: () => !this.lootedTruck,
        run: () => this.lootTruck(),
      },
      {
        id: 'loot-police',
        pos: () => ({ x: LAYOUT.policeLoot.x, z: LAYOUT.policeLoot.z }),
        label: '按住 E · 搜寻警车',
        time: 0.75,
        ok: () => !this.lootedPolice,
        run: () => this.lootPolice(),
      },
      {
        id: 'gate',
        pos: () => ({ x: 0, z: LAYOUT.gateZ - 1.3 }),
        label: this.hasBar ? '按住 E · 用撬棍扳门' : '按住 E · 扳开铁门',
        time: this.hasBar ? 1.05 : 2.05,
        ok: () => !this.gateOpen && this.foot.z > 255,
        run: () => this.openGate(),
      },
      {
        id: 'side',
        pos: () => ({ x: LAYOUT.sideDoor.x, z: LAYOUT.sideDoor.z - 1.2 }),
        label: '按住 E · 打开检修门',
        time: this.hasBar ? 0.75 : 1.2,
        ok: () => !this.sideOpen && this.foot.z > 255,
        run: () => this.openSide(),
      },
    ];
  }

  private exitTruck(): void {
    const door = this.truck.door();
    this.riding = false;
    this.foot.x = door.x;
    this.foot.z = door.z;
    this.foot.y = 0;
    this.foot.yaw = this.truck.yaw + this.cab;
    this.foot.pitch = this.pitch;
    this.foot.vx = 0;
    this.foot.vz = 0;
    this.cab = 0;
    if (!this.footHint) {
      this.footHint = true;
      this.host.hint('WASD 移动 · 按住 E 搜寻 · F 头灯', 4.2);
    }
  }

  private enterTruck(): void {
    if (!this.truck.drivable) return;
    this.riding = true;
    this.cab = 0;
    this.pitch = -0.08;
  }

  private lootTruck(): void {
    this.lootedTruck = true;
    this.hasFlash = true;
    this.flashOn = true;
    this.hasBar = true;
    if (this.weapon === 'hands') this.weapon = 'bar';
    this.host.audio.click();
    this.host.hint('手电，断柄撬棍。', 2.2);
  }

  private lootPolice(): void {
    this.lootedPolice = true;
    this.hasGun = true;
    this.ammoIn = TUNE.ammoIn;
    this.ammoRes = TUNE.ammoReserve;
    this.weapon = 'gun';
    this.mark('radio');
    this.host.audio.radio();
    const lines: [string, string, number][] = [
      ['青台', '报一下位置。', 1.7],
      ['林肖', '南岸公路。', 1.5],
      ['青台', '南岸馈线全黑，你先到站。过桥的事后说。', 3.5],
      ['林肖', '渡的电话呢？', 1.7],
      ['青台', '占线，或者没电。卫生院还在要电，你弟那边我打不通。', 4.3],
      ['青台', '你别在路上停太久。', 2.2],
    ];
    for (const [who, text, seconds] of lines) this.host.say(who, text, seconds);
  }

  private openGate(): void {
    this.gateOpen = true;
    this.host.audio.thud();
  }

  private openSide(): void {
    this.sideOpen = true;
    this.host.audio.thud();
  }

  private handleGear(snap: { fire: boolean; melee: boolean; reload: boolean; flashlight: boolean; slot1: boolean; slot2: boolean }): void {
    if (snap.slot1 && this.hasBar) this.weapon = 'bar';
    if (snap.slot2 && this.hasGun) this.weapon = 'gun';
    if (snap.flashlight) {
      if (!this.hasFlash) {
        if (!this.flashHint) {
          this.flashHint = true;
          this.host.hint('手电在车里。', 1.8);
        }
      } else this.flashOn = !this.flashOn;
    }
    if (snap.reload) this.startReload();
    if (snap.melee) this.melee();
    if (snap.fire) {
      if (this.weapon === 'gun' && this.hasGun) this.shoot();
      else this.melee();
    }
  }

  private startReload(): void {
    if (!this.hasGun || this.reloadT > 0 || this.ammoIn >= TUNE.magSize || this.ammoRes <= 0) return;
    this.reloadT = 1.2;
    this.host.audio.click();
  }

  private tickReload(dt: number): void {
    if (this.reloadT <= 0) return;
    this.reloadT -= dt;
    if (this.reloadT > 0) return;
    const need = TUNE.magSize - this.ammoIn;
    const take = Math.min(need, this.ammoRes);
    this.ammoIn += take;
    this.ammoRes -= take;
  }

  private shoot(): void {
    if (this.riding || this.reloadT > 0) return;
    if (this.ammoIn <= 0) {
      this.host.audio.dry();
      this.host.hint('没子弹了。R 换弹。', 1.8);
      return;
    }
    this.ammoIn -= 1;
    this.host.audio.shot();
    this.kick += 0.03;
    const aim = this.aim();
    let best: Fever | null = null;
    let bestD = 28;
    for (const enemy of this.enemies) {
      if (enemy.down) continue;
      const dx = enemy.x - aim.x;
      const dy = 1.25 - aim.y;
      const dz = enemy.z - aim.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 30) continue;
      const dot = (dx / dist) * aim.dx + (dy / dist) * aim.dy + (dz / dist) * aim.dz;
      if (dot < Math.cos(0.1)) continue;
      if (dist < bestD) {
        best = enemy;
        bestD = dist;
      }
    }
    if (best && best.hurt(TUNE.pistolDamage) === 'down') this.onDown();
  }

  private melee(): void {
    if (this.riding || this.meleeCd > 0) return;
    this.meleeCd = 0.52;
    this.host.audio.swing();
    const aim = this.aim();
    const range = this.hasBar && this.weapon !== 'gun' ? 2.35 : this.hasBar ? 2.15 : 1.6;
    const damage = this.hasBar ? TUNE.crowbarDamage : TUNE.shoveDamage;
    let best: Fever | null = null;
    let bestD = range;
    for (const enemy of this.enemies) {
      if (enemy.down) continue;
      const dx = enemy.x - this.foot.x;
      const dz = enemy.z - this.foot.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range || dist < 0.001) continue;
      const dot = (dx / dist) * aim.dx + (dz / dist) * aim.dz;
      if (dot < 0.3) continue;
      if (dist < bestD) {
        best = enemy;
        bestD = dist;
      }
    }
    if (!best) return;
    this.host.audio.thud();
    if (best.hurt(damage) === 'down') this.onDown();
  }

  private onDown(): void {
    if (this.toldHurt) return;
    this.toldHurt = true;
    this.host.hint('R 换弹 · V 近战', 6);
  }

  private aim(): { x: number; y: number; z: number; dx: number; dy: number; dz: number } {
    const pitch = this.riding ? this.pitch : this.foot.pitch;
    const yaw = this.riding ? this.truck.yaw + this.cab : this.foot.yaw;
    const cp = Math.cos(pitch);
    const eye = this.riding ? this.truck.seat() : { x: this.foot.x, y: this.foot.eye(), z: this.foot.z };
    return { x: eye.x, y: eye.y, z: eye.z, dx: Math.sin(yaw) * cp, dy: Math.sin(pitch), dz: Math.cos(yaw) * cp };
  }

  private hurt(amount: number): void {
    if (this.invuln > 0 || this.health <= 0 || this.mode !== 'play') return;
    this.health = Math.max(0, this.health - amount);
    this.invuln = 0.65;
    this.shake = 0.4;
    this.host.audio.hurt();
    if (this.health > 0 && !this.toldHurt) {
      this.toldHurt = true;
      this.host.hint('R 换弹 · V 近战', 6);
    }
    if (this.health <= 0) this.beginFail('down');
  }

  private separateEnemies(): void {
    for (let i = 0; i < this.enemies.length; i++) {
      for (let j = i + 1; j < this.enemies.length; j++) {
        const a = this.enemies[i];
        const b = this.enemies[j];
        if (a.down || b.down) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.001 || dist >= 0.8) continue;
        const push = (0.8 - dist) * 0.5;
        b.x += (dx / dist) * push;
        b.z += (dz / dist) * push;
      }
    }
  }

  private checkWorld(): void {
    if (this.mode !== 'play' || this.riding) return;
    if (environmentFail(this.foot.x, this.foot.z, LAYOUT.ditch, LAYOUT.bridge)) this.beginFail('ditch');
    if (!this.policeHint && !this.lootedPolice) {
      const dist = Math.hypot(this.foot.x - LAYOUT.policeLoot.x, this.foot.z - LAYOUT.policeLoot.z);
      if (dist < 18) {
        this.policeHint = true;
        this.host.hint('警车还开着双闪。', 2.2);
      }
    }
  }

  private checkGate(): void {
    if (this.mode !== 'play' || this.riding) return;
    if (!(this.gateOpen || this.sideOpen)) return;
    if (this.foot.z < 263.9) return;
    this.mode = 'end';
    this.endT = 2.3;
    this.mark('enter');
    this.mark('road');
    this.host.audio.discharge();
    this.host.say('', '变压器在响。', 2.2);
    this.prompt = '';
    this.promptHold = -1;
  }

  private beginFail(kind: 'down' | 'ditch'): void {
    if (this.mode !== 'play') return;
    this.mode = 'fail';
    this.failKind = kind;
    this.failT = kind === 'ditch' ? 1.3 : 0.85;
    this.riding = false;
    this.truck.speed = 0;
    this.prompt = '';
    this.promptHold = -1;
  }

  private mark(id: string): void {
    const item = this.objectives.find((entry) => entry.id === id);
    if (item) item.done = true;
  }

  private applyLook(lookX: number, lookY: number): void {
    if (this.riding) {
      this.cab = clamp(steerYaw(this.cab, lookX), -1.15, 1.15);
      this.pitch = clamp(this.pitch + lookY, -0.55, 0.42);
    } else {
      this.foot.yaw = steerYaw(this.foot.yaw, lookX);
      this.foot.pitch = clamp(this.foot.pitch + lookY, -1.15, 1.15);
    }
  }

  private visuals(dt: number): void {
    const open = 1 - Math.exp(-dt * 3);
    if (this.gateOpen) {
      this.gateL.rotation.y += (-1.4 - this.gateL.rotation.y) * open;
      this.gateR.rotation.y += (1.4 - this.gateR.rotation.y) * open;
    }
    if (this.sideOpen) this.sideDoor.rotation.y += (-1.35 - this.sideDoor.rotation.y) * open;
    const head = this.headOn();
    this.truck.setHead(head);
    this.truck.sync();
    const blink = Math.sin(this.t * 10) > 0;
    this.policeRed.uniforms.uGain.value = blink ? 3.2 : 0.15;
    this.policeBlue.uniforms.uGain.value = blink ? 0.15 : 3.2;
    this.syncLights(head);
    this.syncCamera();
    this.syncView();
    this.host.audio.engine(this.truck.engine, Math.abs(this.truck.speed));
    const low = this.health < 45 ? (45 - this.health) / 70 : 0;
    this.host.setDamage(Math.max(low, this.shake));
  }

  private headOn(): boolean {
    if (this.truck.engine !== 'off') return true;
    if (this.flicker > 0) return Math.sin(this.t * 42) > 0;
    return false;
  }

  private syncLights(head: boolean): void {
    const lamps = this.host.night.lights;
    const bumper = this.truck.bumper();
    const yaw = this.truck.yaw;
    lamps[0].pos.set(bumper.x, 0.85, bumper.z);
    lamps[0].dir.set(Math.sin(yaw), -0.06, Math.cos(yaw));
    lamps[0].color.set(1, 0.84, 0.58);
    lamps[0].range = 52;
    lamps[0].angle = 0.42;
    lamps[0].intensity = head ? 4.8 : 0;
    const aim = this.aim();
    lamps[1].pos.set(aim.x, aim.y, aim.z);
    lamps[1].dir.set(aim.dx, aim.dy, aim.dz);
    lamps[1].color.set(0.75, 0.84, 0.96);
    lamps[1].range = 20;
    lamps[1].angle = 0.9;
    lamps[1].intensity = !this.riding && this.flashOn ? 2.6 : 0;
    lamps[2].pos.set(LAYOUT.policeLoot.x, 1.6, LAYOUT.policeLoot.z);
    lamps[2].dir.set(0, -1, 0);
    lamps[2].color.set(blinkColor(this.t));
    lamps[2].range = 12;
    lamps[2].angle = -1;
    lamps[2].intensity = 1.8;
    lamps[3].pos.set(0.2, 2.3, LAYOUT.gateZ - 0.4);
    lamps[3].dir.set(0, -1, 0);
    lamps[3].color.set(1, 0.55, 0.18);
    lamps[3].range = 8;
    lamps[3].angle = -1;
    lamps[3].intensity = 0.55 + 0.2 * Math.sin(this.t * 3);
  }

  private syncCamera(): void {
    const cam = this.host.camera;
    if (cam.fov !== this.host.settings.fov) {
      cam.fov = this.host.settings.fov;
      cam.updateProjectionMatrix();
    }
    let x: number;
    let y: number;
    let z: number;
    let yaw: number;
    let pitch: number;
    if (this.riding) {
      const seat = this.truck.seat();
      const vib = this.truck.engine === 'off' ? 0 : Math.sin(this.t * 46) * 0.004;
      x = seat.x;
      y = seat.y + vib;
      z = seat.z;
      yaw = this.truck.yaw + this.cab;
      pitch = this.pitch;
    } else {
      const bob = Math.sin(this.bob) * 0.012 * this.bobAmt;
      x = this.foot.x;
      y = this.foot.eye() + bob;
      z = this.foot.z;
      yaw = this.foot.yaw;
      pitch = this.foot.pitch;
    }
    if (this.shake > 0) {
      x += Math.sin(this.t * 73) * 0.02 * this.shake;
      y += Math.cos(this.t * 61) * 0.015 * this.shake;
    }
    const cp = Math.cos(pitch);
    cam.position.set(x, y, z);
    cam.up.set(0, 1, 0);
    cam.lookAt(x + Math.sin(yaw) * cp, y + Math.sin(pitch), z + Math.cos(yaw) * cp);
  }

  private syncView(): void {
    const onFoot = !this.riding && this.mode === 'play';
    this.view.visible = onFoot;
    this.flashBeam.visible = onFoot && this.flashOn;
    this.barMesh.visible = this.hasBar && this.weapon !== 'gun';
    this.gunMesh.visible = this.hasGun && this.weapon === 'gun';
    this.lampMat.uniforms.uGain.value = this.flashOn ? 1.6 : 0;
    if (!onFoot) return;
    this.view.position.y = -0.32 + Math.sin(this.bob) * 0.018 * this.bobAmt;
    this.view.position.x = 0.26 + Math.cos(this.bob * 0.5) * 0.01 * this.bobAmt;
  }

  private buildView(): void {
    this.view = new THREE.Group();
    this.view.position.set(0.26, -0.32, -0.5);
    const sleeve = meshBox(this.lit, 0.12, 0.1, 0.32, 0x2a3642);
    sleeve.position.set(0.02, -0.02, 0.06);
    this.barMesh = meshBox(this.lit, 0.045, 0.045, 0.62, 0x6e604c);
    this.barMesh.position.set(0.04, -0.05, -0.02);
    this.barMesh.rotation.y = 0.15;
    this.gunMesh = meshBox(this.lit, 0.06, 0.1, 0.26, 0x24282c);
    this.gunMesh.position.set(0.05, -0.04, -0.02);
    this.lampMat = emissiveMaterial(0xd5e6f5, 0);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.09), this.lampMat);
    lamp.position.set(-0.06, 0.02, -0.05);
    this.view.add(sleeve, this.barMesh, this.gunMesh, lamp);
    this.host.camera.add(this.view);
    this.flashBeam = createBeam();
    const beamMat = this.flashBeam.material as THREE.ShaderMaterial;
    beamMat.uniforms.uColor.value.set(0xc9d7e6);
    beamMat.uniforms.uAlpha.value = 0.22;
    this.flashBeam.position.set(0.05, -0.08, -0.25);
    this.flashBeam.scale.set(1.5, 1.5, 11);
    this.host.camera.add(this.flashBeam);
    this.gunMesh.visible = false;
    this.barMesh.visible = false;
  }

  private buildWorld(): void {
    const field = this.host.night;
    const white = new THREE.Color(1, 1, 1);
    const snow = new THREE.Mesh(new THREE.PlaneGeometry(90, 340), this.lit);
    paint(snow.geometry, white);
    snow.rotation.x = -Math.PI / 2;
    snow.position.set(0, 0, 140);
    tagMode(snow, field, 2);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 280), this.lit);
    paint(road.geometry, white);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.03, 130);
    tagMode(road, field, 1);
    const ice = new THREE.Mesh(new THREE.PlaneGeometry(7.2, LAYOUT.ice.z1 - LAYOUT.ice.z0), this.lit);
    paint(ice.geometry, white);
    ice.rotation.x = -Math.PI / 2;
    ice.position.set(0, 0.045, (LAYOUT.ice.z0 + LAYOUT.ice.z1) / 2);
    tagMode(ice, field, 3);
    const ditch = new THREE.Mesh(new THREE.PlaneGeometry(10, 18), this.lit);
    paint(ditch.geometry, white);
    ditch.rotation.x = -Math.PI / 2;
    ditch.position.set(-8.2, -1.15, 136);
    tagMode(ditch, field, 5);
    const creek = new THREE.Mesh(new THREE.PlaneGeometry(22, 30), this.lit);
    paint(creek.geometry, white);
    creek.rotation.x = -Math.PI / 2;
    creek.position.set(0, -1.25, 204);
    tagMode(creek, field, 4);
    const river = new THREE.Mesh(new THREE.PlaneGeometry(50, 360), this.lit);
    paint(river.geometry, white);
    river.rotation.x = -Math.PI / 2;
    river.position.set(48, -1.5, 140);
    tagMode(river, field, 4);
    const shoulderL = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 280), this.lit);
    paint(shoulderL.geometry, white);
    shoulderL.rotation.x = -Math.PI / 2;
    shoulderL.position.set(-5.05, 0.045, 130);
    tagMode(shoulderL, field, 2);
    const shoulderR = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 280), this.lit);
    paint(shoulderR.geometry, white);
    shoulderR.rotation.x = -Math.PI / 2;
    shoulderR.position.set(5.05, 0.045, 130);
    tagMode(shoulderR, field, 2);
    this.root.add(snow, road, shoulderL, shoulderR, ice, ditch, creek, river);

    for (const box of staticSolids()) this.addSolid(box);
    for (const box of fenceSolids(true, true)) this.addSolid(box);
    this.addDoors();
    this.addSign(['南岸变电站', '4 公里'], LAYOUT.sign.x, LAYOUT.sign.z, 0.08);
    this.addSign(['南岸变电站'], 0, LAYOUT.gateZ - 0.8, 0);
    this.addRoadDressing();
    this.addTrees();
    this.addPoles();
    this.addFarBank();
    const amber = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), emissiveMaterial(0xff8a2a, 1.4));
    amber.position.set(-1.35, 2.15, LAYOUT.gateZ - 0.2);
    this.root.add(amber);
    const yard = meshBox(this.lit, 1.4, 2.4, 1.4, 0x2a3036);
    yard.position.set(4.2, 1.2, 274);
    const yard2 = meshBox(this.lit, 1.1, 1.8, 1.1, 0x262c32);
    yard2.position.set(6.1, 0.9, 273.2);
    this.root.add(yard, yard2);
  }

  private addSolid(box: AABB): void {
    if (box.tag === 'block') return;
    if (box.tag === 'car' || box.tag === 'police') {
      this.addCar(box, box.tag === 'police');
      return;
    }
    if (box.tag === 'post') {
      const geo = new THREE.CylinderGeometry(0.12, 0.14, box.maxY, 6);
      paint(geo, new THREE.Color(0x2c3034));
      const mesh = new THREE.Mesh(geo, this.lit);
      mesh.position.set((box.minX + box.maxX) / 2, box.maxY / 2, (box.minZ + box.maxZ) / 2);
      this.root.add(mesh);
      return;
    }
    const color = box.tag === 'bank' ? 0x9aa3ae : box.tag === 'building' ? 0x1a1e24 : box.tag === 'fence' ? 0x3a4048 : 0x2a3036;
    const mesh = meshBox(
      this.lit,
      box.maxX - box.minX,
      box.maxY - box.minY,
      box.maxZ - box.minZ,
      color,
    );
    mesh.position.set((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
    this.root.add(mesh);
  }

  private addCar(box: AABB, police: boolean): void {
    const w = box.maxX - box.minX;
    const d = box.maxZ - box.minZ;
    const group = new THREE.Group();
    group.position.set((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2);
    const seed = Math.sin(box.minZ * 12.3 + box.minX);
    group.rotation.y = seed * 0.2;
    group.rotation.z = seed * 0.03;
    const paintColor = police ? 0xd5dbe2 : 0x2c3138;
    const body = meshBox(this.lit, w * 0.88, 0.38, d * 0.86, paintColor);
    body.position.set(0, 0.46, 0);
    const cabin = meshBox(this.lit, w * 0.7, 0.34, d * 0.38, police ? 0xb7c0c8 : 0x1c2026);
    cabin.position.set(0, 0.78, -d * 0.08);
    const glass = meshBox(this.lit, w * 0.6, 0.18, 0.04, 0x1a2830);
    glass.position.set(0, 0.84, d * 0.1);
    const hood = meshBox(this.lit, w * 0.82, 0.1, d * 0.26, paintColor);
    hood.position.set(0, 0.58, d * 0.28);
    const snowCap = meshBox(this.lit, w * 0.64, 0.07, d * 0.34, 0xe7eef4);
    snowCap.position.set(0, 0.98, -d * 0.06);
    const drift = meshBox(this.lit, w * 1.02, 0.14, d * 0.42, 0xd7e0e8);
    drift.position.set(seed * 0.12, 0.07, -d * 0.18);
    group.add(body, cabin, glass, hood, snowCap, drift);
    const wheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.14, 8);
    paint(wheelGeo, new THREE.Color(0x121212));
    for (const wx of [-w * 0.38, w * 0.38]) {
      for (const wz of [-d * 0.3, d * 0.3]) {
        const wheel = new THREE.Mesh(wheelGeo, this.lit);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, 0.18, wz);
        group.add(wheel);
      }
    }
    if (police) {
      this.policeRed = emissiveMaterial(0xff2a2a, 2);
      this.policeBlue = emissiveMaterial(0x2a4bff, 2);
      const red = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.1), this.policeRed);
      const blue = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.1), this.policeBlue);
      red.position.set(-0.18, 1.08, -d * 0.08);
      blue.position.set(0.18, 1.08, -d * 0.08);
      group.add(red, blue);
    }
    this.root.add(group);
  }

  private addDoors(): void {
    const mat = this.lit;
    this.gateL = new THREE.Group();
    this.gateL.position.set(-1.6, 0, LAYOUT.gateZ);
    const left = meshBox(mat, 1.55, 2.25, 0.1, 0x4a525c);
    left.position.set(0.78, 1.15, 0);
    this.gateL.add(left);
    this.gateR = new THREE.Group();
    this.gateR.position.set(1.6, 0, LAYOUT.gateZ);
    const right = meshBox(mat, 1.55, 2.25, 0.1, 0x4a525c);
    right.position.set(-0.78, 1.15, 0);
    this.gateR.add(right);
    this.sideDoor = new THREE.Group();
    this.sideDoor.position.set(6.35, 0, LAYOUT.gateZ);
    const door = meshBox(mat, 1.7, 2.2, 0.1, 0x5a5344);
    door.position.set(0.85, 1.12, 0);
    const stripe = meshBox(mat, 1.5, 0.08, 0.12, 0xc8b56a);
    stripe.position.set(0.85, 1.3, 0.02);
    this.sideDoor.add(door, stripe);
    this.root.add(this.gateL, this.gateR, this.sideDoor);
    const plate = this.makeLabel('检修门');
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.28), new THREE.MeshBasicMaterial({ map: plate, transparent: true }));
    board.position.set(7.25, 1.7, LAYOUT.gateZ - 0.2);
    board.rotation.y = Math.PI;
    this.root.add(board);
  }

  private addSign(lines: string[], x: number, z: number, tilt: number): void {
    const tex = this.makeSign(lines);
    const towardRoad = Math.abs(x) < 0.2 ? 0 : -Math.sign(x);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.25), signMaterial(this.host.night, tex));
    paint(board.geometry, new THREE.Color(0xffffff));
    board.position.set(x + towardRoad * 1.2, 2.35, z);
    board.rotation.set(0, Math.PI, tilt);
    const cap = meshBox(this.lit, 2.5, 0.08, 0.1, 0xe7eef4);
    cap.position.set(0, 0.66, 0.02);
    board.add(cap);
    const pole = meshBox(this.lit, 0.1, 2.4, 0.1, 0x33383e);
    pole.position.set(x, 1.2, z);
    const arm = meshBox(this.lit, 1.2, 0.07, 0.07, 0x33383e);
    arm.position.set(x + towardRoad * 0.6, 2.35, z);
    this.root.add(board, pole, arm);
  }

  private makeSign(lines: string[]): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.CanvasTexture(canvas);
    ctx.fillStyle = '#1d4c82';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#e4ebf2';
    ctx.lineWidth = 10;
    ctx.strokeRect(12, 12, 488, 232);
    ctx.fillStyle = '#f2f6fa';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = lines.length > 1 ? '68px "WenQuanYi Micro Hei", sans-serif' : '72px "WenQuanYi Micro Hei", sans-serif';
    if (lines.length === 1) ctx.fillText(lines[0], 256, 128);
    else {
      ctx.fillText(lines[0], 256, 100);
      ctx.font = '58px "WenQuanYi Micro Hei", sans-serif';
      ctx.fillText(lines[1], 256, 168);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    this.textures.push(tex);
    return tex;
  }

  private makeLabel(text: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.CanvasTexture(canvas);
    ctx.fillStyle = '#2a261c';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#e6d7a4';
    ctx.font = '42px "WenQuanYi Micro Hei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 50);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(tex);
    return tex;
  }

  private addRoadDressing(): void {
    const clumpGeo = new THREE.BoxGeometry(2.2, 0.18, 2.4);
    paint(clumpGeo, new THREE.Color(0xe8eef3));
    const clumps = new THREE.InstancedMesh(clumpGeo, this.lit, 56);
    const dummy = new THREE.Object3D();
    const rand = mulberry(19);
    let n = 0;
    for (let z = 4; z < 250 && n < 56; z += 8.5) {
      for (const side of [-1, 1]) {
        if (n >= 56) break;
        if (side < 0 && z > 124 && z < 150) continue;
        const jitter = (rand() - 0.5) * 2.2;
        dummy.position.set(side * (4.35 + rand() * 0.85), 0.1, z + jitter);
        dummy.rotation.set((rand() - 0.5) * 0.15, rand() * Math.PI, (rand() - 0.5) * 0.12);
        dummy.scale.set(0.7 + rand() * 0.8, 0.8 + rand() * 1.6, 0.65 + rand() * 0.7);
        dummy.updateMatrix();
        clumps.setMatrixAt(n, dummy.matrix);
        n += 1;
      }
    }
    clumps.count = n;
    clumps.instanceMatrix.needsUpdate = true;
    this.root.add(clumps);
  }

  private addTrees(): void {
    const geo = new THREE.ConeGeometry(0.9, 3.4, 6);
    geo.translate(0, 1.6, 0);
    paint(geo, new THREE.Color(0x121614));
    const mesh = new THREE.InstancedMesh(geo, this.lit, 48);
    const dummy = new THREE.Object3D();
    const rand = mulberry(11);
    let n = 0;
    for (let z = 0; z < 248 && n < 48; z += 13) {
      for (const side of [-1, 1]) {
        if (n >= 48) break;
        if (side < 0 && z > 124 && z < 148) continue;
        dummy.position.set(side * (8.4 + rand() * 1.6), 0, z + (rand() - 0.5) * 3);
        const s = 0.75 + rand() * 0.7;
        dummy.scale.set(s, 0.8 + rand() * 0.6, s);
        dummy.rotation.y = rand() * Math.PI;
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        n += 1;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);
  }

  private addPoles(): void {
    const geo = new THREE.CylinderGeometry(0.08, 0.1, 6.2, 6);
    paint(geo, new THREE.Color(0x23272c));
    const mesh = new THREE.InstancedMesh(geo, this.lit, 12);
    const dummy = new THREE.Object3D();
    let n = 0;
    for (let z = 16; z < 240 && n < 12; z += 22) {
      dummy.position.set(7.7, 3.1, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      n += 1;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);
  }

  private addFarBank(): void {
    for (let i = 0; i < 7; i++) {
      const height = 5 + (i % 3) * 4;
      const block = meshBox(this.lit, 7, height, 9, 0x14181d);
      block.position.set(38 + (i % 2) * 10, height / 2, i * 32 - 8);
      this.root.add(block);
    }
    const geo = new THREE.PlaneGeometry(0.7, 0.9);
    const mesh = new THREE.InstancedMesh(geo, windowMaterial(this.host.night), 28);
    const dummy = new THREE.Object3D();
    let n = 0;
    for (let i = 0; i < 7; i++) {
      for (let row = 0; row < 4; row++) {
        dummy.position.set(34.2, 2.2 + row * 1.3, i * 32 - 6);
        dummy.lookAt(0, dummy.position.y, dummy.position.z);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        n += 1;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);
  }
}

function blinkColor(time: number): THREE.Color {
  const red = Math.sin(time * 10) > 0;
  return red ? new THREE.Color(1, 0.08, 0.05) : new THREE.Color(0.15, 0.25, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
