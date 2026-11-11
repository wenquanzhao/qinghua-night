import * as THREE from 'three';
import type { Kit } from '../kit';
import { FootMover } from '../player';
import { canBind, applyThrow, blankBreakers, nextOrder, type Breakers, type SwitchId } from '../station/switches';
import { STATION, fireDps, inControl, indoors, onEscapeRoad, stationSolids, type DoorLocks } from '../station/layout';
import { Colleague, Stiff, type Hazard } from '../station/people';
import { steerYaw } from '../rules';
import { TUNE } from '../tune';
import type { Chapter, Host, Objective, Report } from '../types';
import type { AABB } from '../layout';
import { barrierGeometry, cabinetGeometry, crateGeometry, layRails, scatter, spoolGeometry } from '../../render/dress';
import {
  createBeam,
  createLitMaterial,
  emissiveMaterial,
  meshBox,
  paint,
  tagMode,
  tagTree,
} from '../../render/night';

interface Spot {
  id: string;
  pos: { x: number; z: number };
  label: string;
  time: number;
  ok: () => boolean;
  run: () => void;
}

const ORDER_TEXT: Record<ReturnType<typeof nextOrder>, string> = {
  inlet2: '先合 2 号进线',
  protect: '保护复位',
  feeder: '再合馈出',
  live: '从侧门撤上辅路',
};

export class StationChapter implements Chapter {
  private readonly root = new THREE.Group();
  private readonly foot = new FootMover();
  private readonly lit: THREE.ShaderMaterial;
  private readonly textures: THREE.Texture[] = [];
  private readonly objectives: Objective[] = [
    { id: 'feed', text: '按顺序合上南岸馈线', done: false },
    { id: 'text', text: '看到林渡的短信', done: false },
    { id: 'leave', text: '从侧门撤到辅路', done: false },
  ];
  private readonly a: Colleague;
  private readonly b: Colleague;
  private readonly stiffs: Stiff[] = [];
  private locks: DoorLocks = { capacitor: false, main: false, west: false };
  private breakers: Breakers = blankBreakers();
  private view!: THREE.Group;
  private barMesh!: THREE.Object3D;
  private gunMesh!: THREE.Object3D;
  private lampMat!: THREE.ShaderMaterial;
  private flashBeam!: THREE.Mesh;
  private capDoor!: THREE.Group;
  private mainDoor!: THREE.Group;
  private westDoor!: THREE.Group;
  private emergency!: THREE.ShaderMaterial;
  private deskLamp!: THREE.ShaderMaterial;
  private sodiums: THREE.ShaderMaterial[] = [];
  private hospitalWins!: THREE.ShaderMaterial;

  private health: number;
  private hasFlash: boolean;
  private flashOn: boolean;
  private headlamp: boolean;
  private hasBar: boolean;
  private hasGun: boolean;
  private ammoIn: number;
  private ammoRes: number;
  private weapon: Kit['weapon'];
  private gloves = false;
  private fuses = false;
  private tea = false;
  private phoneRead = false;
  private extinguisher = 4;
  private blowerLeft = 3;
  private blowerT = 0;
  private isoLeft = 3;
  private isoCool = 0;
  private sprayT = 0;
  private reloadT = 0;
  private meleeCd = 0;
  private invuln = 0;
  private kick = 0;
  private shake = 0;
  private bob = 0;
  private bobAmt = 0;
  private footTick = 0;
  private t = 0;
  private holdId: string | null = null;
  private hold = 0;
  private prompt = '';
  private promptHold = -1;
  private blackout = 0;
  private fire = false;
  private safeT = 0;
  private powered = false;
  private spawnT = 0;
  private spawned = false;
  private saidOrder = false;
  private saidPlea = false;
  private saidLamps = false;
  private mode: 'play' | 'fail' | 'end' = 'play';
  private failKind: 'down' | 'fire' | 'surrounded' = 'down';
  private failT = 0;
  private failReady = false;
  private endT = 0;
  private complete = false;

  constructor(
    private readonly host: Host,
    kit: Kit,
  ) {
    this.lit = createLitMaterial(host.night);
    this.health = kit.health;
    this.hasFlash = kit.hasFlash;
    this.flashOn = kit.flashOn && kit.hasFlash;
    this.headlamp = kit.headlamp;
    this.hasBar = kit.hasBar;
    this.hasGun = kit.hasGun;
    this.ammoIn = kit.ammoIn;
    this.ammoRes = kit.ammoReserve;
    this.weapon = kit.weapon;
    this.a = new Colleague(this.root, this.lit, STATION.colleagueA.x, STATION.colleagueA.z, true, 3.6);
    this.b = new Colleague(this.root, this.lit, STATION.colleagueB.x, STATION.colleagueB.z, false, 2.3);
  }

  mount(): void {
    this.host.scene.add(this.root);
    this.build();
    this.buildView();
    this.foot.x = STATION.spawn.x;
    this.foot.z = STATION.spawn.z;
    this.foot.yaw = 0;
    tagTree(this.a.root, this.host.night, 9);
    tagTree(this.b.root, this.host.night, 9);
    this.host.hint('先合 2 号进线，再复位，再馈出。', 4.2);
  }

  dispose(): void {
    const drop = (obj: THREE.Object3D) => {
      obj.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material;
        if (!material || material === this.lit) return;
        const list = Array.isArray(material) ? material : [material];
        for (const entry of list) entry.dispose();
      });
    };
    drop(this.root);
    if (this.view) drop(this.view);
    this.lampMat?.dispose();
    this.lit.dispose();
    for (const tex of this.textures) tex.dispose();
    this.host.scene.remove(this.root);
    this.view?.removeFromParent();
    this.flashBeam?.removeFromParent();
    this.host.night.zero();
    this.host.night.resetMood();
  }

  present(dt: number): void {
    this.t += dt;
    this.visuals(dt);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.mode === 'fail') {
      this.failT -= dt;
      this.foot.pitch = Math.max(-1.1, this.foot.pitch - dt);
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
    this.foot.yaw = steerYaw(this.foot.yaw, snap.lookX);
    this.foot.pitch = clamp(this.foot.pitch + snap.lookY, -1.15, 1.15);
    this.kick *= Math.max(0, 1 - 8 * dt);
    this.foot.pitch = clamp(this.foot.pitch + this.kick, -1.15, 1.15);
    this.shake = Math.max(0, this.shake - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    this.isoCool = Math.max(0, this.isoCool - dt);
    this.blackout = Math.max(0, this.blackout - dt);
    if (this.blowerT > 0) this.blowerT = Math.max(0, this.blowerT - dt);
    if (this.sprayT > 0) this.sprayT = Math.max(0, this.sprayT - dt);
    const solids = stationSolids(this.locks);
    this.walk(dt, snap, solids);
    this.people(dt, solids);
    this.fireTick(dt);
    this.updateInteract(dt, snap.interact, snap.interactPressed);
    this.handleGear(snap);
    this.tickReload(dt);
    if (this.powered && onEscapeRoad(this.foot.x, this.foot.z)) this.beginEnd();
    if (!this.saidOrder && inControl(this.foot.x, this.foot.z)) {
      this.saidOrder = true;
      this.host.say('青台', '2 号进线，保护复位，再馈出。别一起推。', 4.2);
      this.host.audio.radio();
    }
    this.visuals(dt);
  }

  report(): Report {
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
      riding: false,
      fail: this.failReady ? this.failKind : null,
      complete: this.complete,
      handoff: null,
      kit: null,
      place: '第二章 · 南岸变电站',
      crosshair: this.mode === 'play',
      debug: `站 ${this.foot.x.toFixed(1)} ${this.foot.z.toFixed(1)} ${nextOrder(this.breakers)}`,
    };
  }

  private primary(): string {
    if (this.fire) return '站里起火了。灭火，或退到安全的地方';
    if (this.blackout > 0) return '保护跳了。等灯回来';
    if (this.powered) return '钠灯亮了。从侧门撤上辅路';
    return ORDER_TEXT[nextOrder(this.breakers)];
  }

  private walk(dt: number, snap: { moveX: number; moveY: number; sprint: boolean; jump: boolean; crouch: boolean }, solids: AABB[]): void {
    this.foot.wantCrouch = snap.crouch;
    this.foot.update(dt, snap.moveX, snap.moveY, snap.sprint, snap.jump, solids, this.circles(), false, false);
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

  private circles(): { x: number; z: number; r: number }[] {
    const list: { x: number; z: number; r: number }[] = [];
    if (this.a.blocks()) list.push({ x: this.a.x, z: this.a.z, r: 0.42 });
    if (this.b.blocks()) list.push({ x: this.b.x, z: this.b.z, r: 0.42 });
    for (const stiff of this.stiffs) {
      if (stiff.blocks()) list.push({ x: stiff.x, z: stiff.z, r: 0.4 });
    }
    return list;
  }

  private people(dt: number, solids: AABB[]): void {
    const hazards = this.hazards();
    for (const mate of [this.a, this.b]) {
      for (const hazard of hazards) {
        if (Math.hypot(mate.x - hazard.x, mate.z - hazard.z) < hazard.r) mate.knock(2.2);
      }
      if (mate.update(dt, this.foot.x, this.foot.z, solids)) this.hurt(TUNE.biteDamage);
    }
    const aim = this.aim();
    const fear = this.headlamp ? 0.35 : 0.62;
    for (const stiff of this.stiffs) {
      const hit = stiff.update(dt, this.foot.x, this.foot.z, aim.dx, aim.dz, this.flashOn && this.hasFlash, fear, hazards, solids);
      if (hit) this.hurt(TUNE.biteDamage);
    }
    if (this.powered && !this.spawned) {
      this.spawnT += dt;
      if (this.spawnT >= 1.5) {
        this.spawned = true;
        for (const spot of STATION.stiffs) {
          const stiff = new Stiff(this.root, this.lit, spot.x, spot.z);
          tagTree(stiff.root, this.host.night, 9);
          this.stiffs.push(stiff);
        }
      }
    }
  }

  private hazards(): Hazard[] {
    const list: Hazard[] = [];
    if (this.blowerT > 0) {
      list.push({ x: STATION.blower.x + 3.2, z: STATION.blower.z, r: 2.4 });
      list.push({ x: STATION.blower.x + 6.4, z: STATION.blower.z, r: 2.1 });
    }
    if (this.sprayT > 0) {
      const aim = this.aim();
      list.push({ x: this.foot.x + aim.dx * 2.2, z: this.foot.z + aim.dz * 2.2, r: 1.8 });
    }
    return list;
  }

  private fireTick(dt: number): void {
    if (!this.fire || this.mode !== 'play') return;
    if (fireDps(this.foot.x, this.foot.z) <= 0) {
      this.safeT += dt;
      if (this.safeT >= 1) {
        this.fire = false;
        this.safeT = 0;
        this.host.hint('火留在后面。', 2);
      }
      return;
    }
    this.safeT = 0;
    this.hurt(fireDps(this.foot.x, this.foot.z) * dt);
  }

  private updateInteract(dt: number, held: boolean, pressed: boolean): void {
    void pressed;
    const spot = this.pickSpot();
    if (!spot) {
      this.hold = 0;
      this.holdId = null;
      this.prompt = '';
      this.promptHold = -1;
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
    const yaw = this.foot.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    let best: Spot | null = null;
    let bestD = 1.85;
    for (const spot of this.spots()) {
      if (!spot.ok()) continue;
      const dx = spot.pos.x - this.foot.x;
      const dz = spot.pos.z - this.foot.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.8) continue;
      const dot = dist < 0.001 ? 1 : (dx / dist) * fx + (dz / dist) * fz;
      if (dot < 0.12 && dist > 1.15) continue;
      if (dist < bestD) {
        best = spot;
        bestD = dist;
      }
    }
    return best;
  }

  private spots(): Spot[] {
    const sw = (id: SwitchId, pos: { x: number; z: number }, label: string, time: number): Spot => ({
      id,
      pos,
      label,
      time,
      ok: () => !this.powered && !this.fire && this.blackout <= 0,
      run: () => this.throwSwitch(id),
    });
    return [
      sw('inlet2', STATION.inlet2, '按住 E · 2 号进线', 0.65),
      sw('protect', STATION.protect, '按住 E · 保护复位', 0.65),
      sw('feeder', STATION.feeder, '按住 E · 馈出', 0.65),
      sw('inlet1', STATION.inlet1, '按住 E · 1 号进线', 0.85),
      {
        id: 'phone',
        pos: STATION.phone,
        label: '按住 E · 未读短信',
        time: 0.45,
        ok: () => !this.phoneRead,
        run: () => this.readPhone(),
      },
      {
        id: 'gloves',
        pos: STATION.gloves,
        label: '按住 E · 绝缘手套',
        time: 0.45,
        ok: () => !this.gloves,
        run: () => {
          this.gloves = true;
          this.host.audio.click();
          this.host.hint('绝缘手套。', 1.6);
        },
      },
      {
        id: 'lamp',
        pos: STATION.headlamp,
        label: '按住 E · 头灯',
        time: 0.45,
        ok: () => !this.headlamp,
        run: () => {
          this.headlamp = true;
          this.hasFlash = true;
          this.flashOn = true;
          this.host.audio.click();
          this.host.hint('头灯比手电宽。', 1.8);
        },
      },
      {
        id: 'fuses',
        pos: STATION.fuses,
        label: '按住 E · 保险丝',
        time: 0.45,
        ok: () => !this.fuses,
        run: () => {
          this.fuses = true;
          this.host.audio.click();
          this.host.hint('备用保险丝。', 1.6);
        },
      },
      {
        id: 'tea',
        pos: STATION.tea,
        label: '按住 E · 冷茶',
        time: 0.4,
        ok: () => !this.tea,
        run: () => {
          this.tea = true;
          this.health = Math.min(100, this.health + 18);
          this.host.audio.click();
          this.host.hint('凉的。', 1.4);
        },
      },
      {
        id: 'ext',
        pos: STATION.extinguisher,
        label: this.fire ? '按住 E · 灭火' : '按住 E · 灭火器',
        time: 0.55,
        ok: () => this.extinguisher > 0,
        run: () => this.useExtinguisher(),
      },
      {
        id: 'blow',
        pos: STATION.blower,
        label: '按住 E · 热风枪',
        time: 0.45,
        ok: () => this.blowerLeft > 0 && this.blowerT <= 0,
        run: () => {
          this.blowerLeft -= 1;
          this.blowerT = 5.2;
          this.host.audio.spray();
        },
      },
      {
        id: 'iso',
        pos: STATION.isolator,
        label: '按住 E · 踩隔离开关',
        time: 0.35,
        ok: () => this.isoLeft > 0 && this.isoCool <= 0,
        run: () => this.stomp(STATION.isolator.x, STATION.isolator.z),
      },
      {
        id: 'iso-out',
        pos: STATION.exitIsolator,
        label: '按住 E · 踩隔离开关',
        time: 0.35,
        ok: () => this.isoLeft > 0 && this.isoCool <= 0,
        run: () => this.stomp(STATION.exitIsolator.x, STATION.exitIsolator.z),
      },
      {
        id: 'cap',
        pos: { x: 2.35, z: 11.05 },
        label: this.locks.capacitor ? '按住 E · 打开电容室' : '按住 E · 锁上电容室',
        time: 0.55,
        ok: () => true,
        run: () => {
          this.locks = { ...this.locks, capacitor: !this.locks.capacitor };
          this.host.audio.thud();
        },
      },
      {
        id: 'main',
        pos: { x: 0, z: 18.7 },
        label: this.locks.main ? '按住 E · 打开走廊门' : '按住 E · 锁上走廊门',
        time: 0.55,
        ok: () => this.foot.z < 19.5,
        run: () => {
          this.locks = { ...this.locks, main: !this.locks.main };
          this.host.audio.thud();
        },
      },
      {
        id: 'main-in',
        pos: { x: 0, z: 20.35 },
        label: this.locks.main ? '按住 E · 打开走廊门' : '按住 E · 锁上走廊门',
        time: 0.55,
        ok: () => this.foot.z > 19.9,
        run: () => {
          this.locks = { ...this.locks, main: !this.locks.main };
          this.host.audio.thud();
        },
      },
      {
        id: 'west',
        pos: { x: -8.2, z: 18.75 },
        label: this.locks.west ? '按住 E · 打开西门' : '按住 E · 锁上西门',
        time: 0.55,
        ok: () => this.foot.z < 19.5,
        run: () => {
          this.locks = { ...this.locks, west: !this.locks.west };
          this.host.audio.thud();
        },
      },
      {
        id: 'west-in',
        pos: { x: -8.2, z: 20.4 },
        label: this.locks.west ? '按住 E · 打开西门' : '按住 E · 锁上西门',
        time: 0.55,
        ok: () => this.foot.z > 19.9,
        run: () => {
          this.locks = { ...this.locks, west: !this.locks.west };
          this.host.audio.thud();
        },
      },
      {
        id: 'bind',
        pos: STATION.chair,
        label: '按住 E · 用绝缘胶带绑上',
        time: 1.15,
        ok: () => this.bindTarget() !== null,
        run: () => this.bind(),
      },
    ];
  }

  private bindTarget(): Colleague | null {
    const chair = STATION.chair;
    const mates = [this.b, this.a].filter((mate) =>
      canBind(this.foot.x, this.foot.z, mate.x, mate.z, chair.x, chair.z, mate.down && !mate.bound, mate.bound, true),
    );
    return mates[0] ?? null;
  }

  private bind(): void {
    const mate = this.bindTarget();
    if (!mate) return;
    mate.bind(STATION.chair.x, STATION.chair.z, Math.PI / 2);
    this.host.audio.click();
    this.host.hint('胶带绕上了。', 1.6);
  }

  private throwSwitch(id: SwitchId): void {
    if (this.powered || this.fire || this.blackout > 0) return;
    const result = applyThrow(this.breakers, id);
    this.breakers = result.state;
    if (result.ok === 'short') {
      this.fire = true;
      this.safeT = 0;
      this.blackout = this.fuses ? 1.4 : 2.4;
      this.a.aggro = true;
      this.b.aggro = true;
      this.host.audio.alarm();
      this.host.hint('1 号进线短路了。', 2.4);
    }
    if (!this.gloves && result.ok !== 'noop') {
      this.hurt(8);
      this.host.audio.arc();
    }
    if (this.mode !== 'play') return;
    if (result.ok === 'noop') {
      this.host.audio.click();
      return;
    }
    if (result.ok === 'short') return;
    if (result.ok === 'trip') {
      this.blackout = this.fuses ? 1.4 : 3.2;
      this.a.aggro = true;
      this.b.aggro = true;
      this.host.audio.alarm();
      this.host.hint('顺序错了。保护跳开。', 2.4);
      return;
    }
    this.host.audio.thud();
    if (result.live) this.powerOn();
  }

  private powerOn(): void {
    this.powered = true;
    this.mark('feed');
    this.host.audio.discharge();
    if (!this.saidLamps) {
      this.saidLamps = true;
      this.host.say('青台', '南岸有灯了。桥上情况不明，你过的时候一直叫我。', 4.4);
    }
  }

  private readPhone(): void {
    this.phoneRead = true;
    this.mark('text');
    this.host.audio.breath();
    this.host.say('林渡', '院里今晚人多，发电机声音不对。你要是出工，桥上小心。', 4.6);
  }

  private useExtinguisher(): void {
    if (this.extinguisher <= 0) return;
    this.extinguisher -= 1;
    this.sprayT = 0.7;
    this.host.audio.spray();
    if (this.fire && inControl(this.foot.x, this.foot.z)) {
      this.fire = false;
      this.safeT = 0;
      this.host.hint('火灭了。', 1.8);
    }
  }

  private stomp(x: number, z: number): void {
    this.isoLeft -= 1;
    this.isoCool = 8;
    this.host.audio.arc();
    this.shake = 0.35;
    for (const mate of [this.a, this.b]) {
      if (Math.hypot(mate.x - x, mate.z - z) < 4.4) mate.knock(2.4);
    }
    for (const stiff of this.stiffs) {
      if (Math.hypot(stiff.x - x, stiff.z - z) < 4.4) stiff.knock(2.4);
    }
  }

  private handleGear(snap: { fire: boolean; melee: boolean; reload: boolean; flashlight: boolean; slot1: boolean; slot2: boolean }): void {
    if (snap.slot1 && this.hasBar) this.weapon = 'bar';
    if (snap.slot2 && this.hasGun) this.weapon = 'gun';
    if (snap.flashlight && this.hasFlash) this.flashOn = !this.flashOn;
    if (snap.reload) this.startReload();
    if (snap.melee) this.melee(false);
    if (snap.fire) {
      if (this.weapon === 'gun' && this.hasGun) this.shoot();
      else this.melee(false);
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
    const take = Math.min(TUNE.magSize - this.ammoIn, this.ammoRes);
    this.ammoIn += take;
    this.ammoRes -= take;
  }

  private shoot(): void {
    if (this.reloadT > 0) return;
    if (this.ammoIn <= 0) {
      this.host.audio.dry();
      return;
    }
    this.ammoIn -= 1;
    this.host.audio.shot();
    this.kick += 0.03;
    const aim = this.aim();
    const hit = this.pickFoe(aim, 26, Math.cos(0.1), true);
    if (!hit) return;
    const kind = hit.hurt(TUNE.pistolDamage);
    if (kind === 'down') this.plea(hit);
  }

  private melee(tool: boolean): void {
    void tool;
    if (this.meleeCd > 0) return;
    this.meleeCd = 0.52;
    this.host.audio.swing();
    const aim = this.aim();
    const range = this.hasBar && this.weapon !== 'gun' ? 2.35 : 1.6;
    const damage = this.hasBar && this.weapon !== 'gun' ? TUNE.crowbarDamage : TUNE.shoveDamage;
    const hit = this.pickFoe(aim, range, 0.3, false);
    if (!hit) return;
    this.host.audio.thud();
    const kind = hit.hurt(damage);
    if (kind === 'down') this.plea(hit);
  }

  private plea(hit: Colleague | Stiff): void {
    if (!(hit instanceof Colleague) || this.saidPlea) return;
    this.saidPlea = true;
    this.host.say('林肖', '别过来。', 1.4);
    this.host.hint('检修椅上有绝缘胶带。', 3.2);
  }

  private pickFoe(
    aim: { dx: number; dy: number; dz: number },
    range: number,
    dotMin: number,
    gun: boolean,
  ): Colleague | Stiff | null {
    let best: Colleague | Stiff | null = null;
    let bestD = range;
    const foes: (Colleague | Stiff)[] = [this.a, this.b, ...this.stiffs];
    for (const foe of foes) {
      if (foe instanceof Colleague && (foe.down || foe.bound)) continue;
      if (foe instanceof Stiff && foe.down) continue;
      const dx = foe.x - this.foot.x;
      const dz = foe.z - this.foot.z;
      const dist = gun ? Math.hypot(dx, 1.2 - this.foot.eye(), dz) : Math.hypot(dx, dz);
      if (dist > range || dist < 0.001) continue;
      const dot = gun
        ? (dx / dist) * aim.dx + ((1.2 - this.foot.eye()) / dist) * aim.dy + (dz / dist) * aim.dz
        : (dx / dist) * aim.dx + (dz / dist) * aim.dz;
      if (dot < dotMin) continue;
      if (dist < bestD) {
        best = foe;
        bestD = dist;
      }
    }
    return best;
  }

  private aim(): { dx: number; dy: number; dz: number } {
    const cp = Math.cos(this.foot.pitch);
    return { dx: Math.sin(this.foot.yaw) * cp, dy: Math.sin(this.foot.pitch), dz: Math.cos(this.foot.yaw) * cp };
  }

  private hurt(amount: number): void {
    if (this.invuln > 0 || this.health <= 0 || this.mode !== 'play') return;
    if (amount >= 1) {
      this.invuln = 0.45;
      this.shake = 0.35;
      this.host.audio.hurt();
    }
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.beginFail();
  }

  private beginFail(): void {
    if (this.mode !== 'play') return;
    this.mode = 'fail';
    this.failT = 0.9;
    if (this.fire) this.failKind = 'fire';
    else if (inControl(this.foot.x, this.foot.z)) this.failKind = 'surrounded';
    else this.failKind = 'down';
    this.prompt = '';
    this.promptHold = -1;
  }

  private beginEnd(): void {
    if (this.mode !== 'play') return;
    this.mode = 'end';
    this.endT = 1.4;
    this.mark('leave');
    this.mark('feed');
    this.prompt = '';
    this.promptHold = -1;
  }

  private mark(id: string): void {
    const item = this.objectives.find((entry) => entry.id === id);
    if (item) item.done = true;
  }

  private visuals(dt: number): void {
    const open = 1 - Math.exp(-dt * 6);
    this.capDoor.rotation.y += ((this.locks.capacitor ? 0 : 1.35) - this.capDoor.rotation.y) * open;
    this.mainDoor.rotation.y += ((this.locks.main ? 0 : 1.25) - this.mainDoor.rotation.y) * open;
    this.westDoor.rotation.y += ((this.locks.west ? 0 : -1.25) - this.westDoor.rotation.y) * open;
    const dark = this.blackout > 0;
    const emergency = dark ? (Math.sin(this.t * 28) > 0.2 ? 0.35 : 0) : 1.7 + Math.sin(this.t * 7) * 0.15;
    this.emergency.uniforms.uGain.value = emergency;
    this.deskLamp.uniforms.uGain.value = dark ? 0.05 : 1.5;
    for (const mat of this.sodiums) mat.uniforms.uGain.value = this.powered && !dark ? 2.6 : 0.02;
    this.hospitalWins.uniforms.uGain.value = this.powered && !dark ? 1.8 : 0.04;
    this.syncMood(dark);
    this.syncLights(dark, emergency);
    this.syncCamera();
    this.syncView();
    const low = this.health < 45 ? (45 - this.health) / 70 : 0;
    this.host.setDamage(Math.max(low, this.shake, this.fire ? 0.45 : 0));
  }

  private syncMood(dark: boolean): void {
    const inside = indoors(this.foot.x, this.foot.z);
    const amb = this.host.night.uniforms.uAmbient.value as THREE.Color;
    const fog = this.host.night.uniforms.uFogColor.value as THREE.Color;
    if (inside) {
      amb.set(dark ? 0.012 : 0.045, dark ? 0.014 : 0.05, dark ? 0.02 : 0.07);
      fog.set(this.fire ? 0.22 : 0.05, this.fire ? 0.045 : 0.03, 0.025);
      this.host.night.uniforms.uFogDensity.value = dark ? 0.05 : 0.028;
      this.host.night.uniforms.uIndoor.value = 1;
    } else {
      amb.set(0.16, 0.175, 0.22);
      fog.set(this.powered ? 0.09 : 0.05, this.powered ? 0.06 : 0.055, this.powered ? 0.045 : 0.075);
      this.host.night.uniforms.uFogDensity.value = 0.012;
      this.host.night.uniforms.uIndoor.value = 0;
    }
  }

  private syncLights(dark: boolean, emergency: number): void {
    const lamps = this.host.night.lights;
    const aim = this.aim();
    const eye = this.foot.eye();
    lamps[0].pos.set(this.foot.x, eye, this.foot.z);
    lamps[0].dir.set(aim.dx, aim.dy, aim.dz);
    lamps[0].color.set(this.headlamp ? 0.92 : 0.75, this.headlamp ? 0.9 : 0.84, 0.96);
    lamps[0].range = this.headlamp ? 22 : 14;
    lamps[0].angle = this.headlamp ? 0.62 : 0.86;
    lamps[0].intensity = this.flashOn && this.hasFlash ? (this.headlamp ? 2.1 : 1.55) : 0;
    lamps[1].pos.set(0, 2.85, 7.72);
    lamps[1].dir.set(0, -0.55, -1);
    lamps[1].color.set(1, 0.46, 0.2);
    lamps[1].range = 18;
    lamps[1].angle = 0.15;
    lamps[1].intensity = dark ? 0.2 : 2.4;
    STATION.lamps.forEach((z, index) => {
      const lamp = lamps[index + 2];
      lamp.pos.set(6.35, 5.15, z);
      lamp.dir.set(0.72, -0.62, 0.18);
      lamp.color.set(1, 0.55, 0.16);
      lamp.range = 18;
      lamp.angle = 0.28;
      lamp.intensity = this.powered && !dark ? 3.4 : 0;
    });
    lamps[7].pos.set(0.2, 2.7, 23.4);
    lamps[7].dir.set(0, -1, 0);
    lamps[7].color.set(1, 0.22, 0.12);
    lamps[7].range = 11;
    lamps[7].angle = -1;
    lamps[7].intensity = emergency;
  }

  private syncCamera(): void {
    const cam = this.host.camera;
    if (cam.fov !== this.host.settings.fov) {
      cam.fov = this.host.settings.fov;
      cam.updateProjectionMatrix();
    }
    const bob = Math.sin(this.bob) * 0.012 * this.bobAmt;
    let x = this.foot.x;
    let y = this.foot.eye() + bob;
    const z = this.foot.z;
    if (this.shake > 0) {
      x += Math.sin(this.t * 73) * 0.02 * this.shake;
      y += Math.cos(this.t * 61) * 0.015 * this.shake;
    }
    const pitch = this.foot.pitch;
    const yaw = this.foot.yaw;
    const cp = Math.cos(pitch);
    cam.position.set(x, y, z);
    cam.up.set(0, 1, 0);
    cam.lookAt(x + Math.sin(yaw) * cp, y + Math.sin(pitch), z + Math.cos(yaw) * cp);
  }

  private syncView(): void {
    this.view.visible = this.mode === 'play';
    this.flashBeam.visible = this.mode === 'play' && this.flashOn && this.hasFlash;
    this.barMesh.visible = this.hasBar && this.weapon !== 'gun';
    this.gunMesh.visible = this.hasGun && this.weapon === 'gun';
    this.lampMat.uniforms.uGain.value = this.flashOn ? (this.headlamp ? 2.2 : 1.5) : 0;
    const beam = this.flashBeam.material as THREE.ShaderMaterial;
    beam.uniforms.uAlpha.value = this.headlamp ? 0.12 : 0.07;
    this.flashBeam.scale.set(this.headlamp ? 2.4 : 1.5, this.headlamp ? 2.4 : 1.5, this.headlamp ? 14 : 11);
    this.view.position.y = -0.32 + Math.sin(this.bob) * 0.018 * this.bobAmt;
  }

  private buildView(): void {
    this.view = new THREE.Group();
    this.view.position.set(0.26, -0.32, -0.5);
    const sleeve = meshBox(this.lit, 0.14, 0.12, 0.34, 0x2a3642);
    sleeve.position.set(0.02, -0.02, 0.06);
    tagMode(sleeve, this.host.night, 9);
    this.barMesh = meshBox(this.lit, 0.045, 0.045, 0.62, 0x6e604c);
    this.barMesh.position.set(0.04, -0.05, -0.02);
    this.gunMesh = meshBox(this.lit, 0.06, 0.1, 0.26, 0x24282c);
    this.gunMesh.position.set(0.05, -0.04, -0.02);
    this.lampMat = emissiveMaterial(0xd5e6f5, 0);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), this.lampMat);
    lamp.position.set(-0.02, 0.06, -0.08);
    this.view.add(sleeve, this.barMesh, this.gunMesh, lamp);
    this.host.camera.add(this.view);
    this.flashBeam = createBeam(this.host.night);
    const beamMat = this.flashBeam.material as THREE.ShaderMaterial;
    beamMat.uniforms.uColor.value.set(0xc9d7e6);
    beamMat.uniforms.uAlpha.value = 0.08;
    this.flashBeam.position.set(0.02, -0.02, -0.2);
    this.flashBeam.scale.set(1.5, 1.5, 11);
    this.host.camera.add(this.flashBeam);
  }

  private build(): void {
    const field = this.host.night;
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(36, 70), this.lit);
    paint(yard.geometry, new THREE.Color(1, 1, 1));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(0, 0, 24);
    tagMode(yard, field, 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(22.2, 20.2), this.lit);
    paint(floor.geometry, new THREE.Color(1, 1, 1));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.04, 18.2);
    tagMode(floor, field, 6);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 24), this.lit);
    paint(road.geometry, new THREE.Color(1, 1, 1));
    road.rotation.x = -Math.PI / 2;
    road.position.set(9.1, 0.05, 39);
    tagMode(road, field, 1);
    const ceiling = meshBox(this.lit, 22.4, 0.18, 20.4, 0x121418);
    ceiling.position.set(0, 3.35, 18.2);
    tagMode(ceiling, field, 7);
    this.root.add(yard, floor, road, ceiling);
    for (const solid of stationSolids({ capacitor: false, main: false, west: false })) {
      if (solid.tag === 'ghost' || solid.tag === 'fill') continue;
      if (solid.tag === 'fence') {
        layRails(this.root, this.lit, field, solid.minX, solid.maxX, solid.minZ, solid.maxZ);
        continue;
      }
      const h = solid.maxY - solid.minY;
      const mesh = meshBox(this.lit, solid.maxX - solid.minX, h, solid.maxZ - solid.minZ, this.solidColor(solid.tag));
      mesh.position.set((solid.minX + solid.maxX) / 2, h / 2, (solid.minZ + solid.maxZ) / 2);
      tagMode(mesh, field, solid.tag === 'panel' || solid.tag === 'prop' ? 8 : solid.tag === 'curb' ? 8 : 7);
      if (solid.tag === 'wall' && h > 2) {
        const cap = meshBox(this.lit, solid.maxX - solid.minX, 0.08, Math.min(0.28, solid.maxZ - solid.minZ), 0xe4eef4);
        cap.position.set((solid.minX + solid.maxX) / 2, h + 0.02, (solid.minZ + solid.maxZ) / 2);
        tagMode(cap, field, 2);
        this.root.add(cap);
      }
      this.root.add(mesh);
    }
    this.addYard();
    this.addDoorFrame();
    this.addWindow();
    this.addDoors();
    this.addPanel();
    this.addProps();
    this.addLamps();
    this.addInsulators();
    this.addHospital();
    this.addPipes();
  }

  private solidColor(tag: string): number {
    if (tag === 'fence') return 0x3a424c;
    if (tag === 'panel') return 0x2a3138;
    if (tag === 'curb') return 0x2c3136;
    return 0x24282e;
  }

  private addYard(): void {
    const field = this.host.night;
    scatter(
      this.root,
      this.lit,
      spoolGeometry(),
      [
        { x: -3.6, z: 4.6, ry: 0.4 },
        { x: 3.8, z: 4.4, ry: 1.1 },
        { x: -6.4, z: 5.6, ry: -0.3 },
      ],
      field,
      8,
    );
    scatter(
      this.root,
      this.lit,
      crateGeometry(),
      [
        { x: -3.3, z: 5.5, ry: 0.2 },
        { x: -2.9, z: 5.95, ry: -0.4, s: 0.75 },
        { x: 3.4, z: 5.4, ry: 0.5 },
        { x: 3.9, z: 5.9, ry: 0.1, s: 0.7 },
      ],
      field,
      8,
    );
    scatter(
      this.root,
      this.lit,
      barrierGeometry(),
      [
        { x: -4.2, z: 1.7, ry: 0.15 },
        { x: 4.6, z: 1.55, ry: -0.2 },
      ],
      field,
      8,
    );
    scatter(this.root, this.lit, cabinetGeometry(), [{ x: 9.4, z: 5.4, ry: -0.1 }, { x: -9.6, z: 4.6, ry: 0.2 }], field, 8);
  }

  private addDoorFrame(): void {
    const field = this.host.night;
    const left = meshBox(this.lit, 0.16, 2.7, 0.2, 0x3a444e);
    left.position.set(-1.45, 1.35, 7.85);
    const right = meshBox(this.lit, 0.16, 2.7, 0.2, 0x3a444e);
    right.position.set(1.45, 1.35, 7.85);
    const lintel = meshBox(this.lit, 3.1, 0.16, 0.22, 0x3a444e);
    lintel.position.set(0, 2.7, 7.85);
    const snow = meshBox(this.lit, 3.2, 0.08, 0.28, 0xe4eef4);
    snow.position.set(0, 2.84, 7.85);
    tagMode(left, field, 8);
    tagMode(right, field, 8);
    tagMode(lintel, field, 8);
    tagMode(snow, field, 2);
    this.root.add(left, right, lintel, snow);
  }

  private addWindow(): void {
    for (let i = 0; i < 8; i++) {
      const bar = meshBox(this.lit, 0.06, 2.5, 0.06, 0x1a1e22);
      bar.position.set(-3.9 + i * 0.95, 1.45, 28.28);
      tagMode(bar, this.host.night, 8);
      this.root.add(bar);
    }
    const sill = meshBox(this.lit, 7.4, 0.12, 0.16, 0x2a3036);
    sill.position.set(-0.5, 0.55, 28.28);
    const frost = meshBox(this.lit, 7.2, 0.08, 0.08, 0xd5e4ec);
    frost.position.set(-0.5, 2.55, 28.32);
    tagMode(frost, this.host.night, 3);
    this.root.add(sill, frost);
  }

  private addDoors(): void {
    this.capDoor = this.hinge(3.35, 10.05, 0.12, 2.15, 2.0, 0x3a4048, 0, 1);
    this.mainDoor = this.hinge(-0.85, 19.7, 1.7, 2.2, 0.1, 0x3c342c, 0.85, 0);
    this.westDoor = this.hinge(-9.35, 19.7, 2.05, 2.2, 0.1, 0x343a42, 1.02, 0);
    this.capDoor.rotation.y = 1.35;
    this.mainDoor.rotation.y = 1.25;
    this.westDoor.rotation.y = -1.25;
  }

  private hinge(x: number, z: number, w: number, h: number, d: number, color: number, ox: number, oz: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const door = meshBox(this.lit, w, h, d, color);
    door.position.set(ox, h / 2, oz);
    tagMode(door, this.host.night, 8);
    group.add(door);
    this.root.add(group);
    return group;
  }

  private addPanel(): void {
    const board = this.label(
      ['2号进线  →  保护复位  →  馈出', '别一起推', '1号进线    禁止'],
      7.2,
      2.3,
    );
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.72), this.basic(board));
    plate.position.set(8.55, 1.55, 26.55);
    plate.rotation.y = -Math.PI / 2;
    this.root.add(plate);
    const marks: [string, { x: number; z: number }][] = [
      ['2号进线', STATION.inlet2],
      ['保护复位', STATION.protect],
      ['馈出', STATION.feeder],
      ['1号 禁止', STATION.inlet1],
    ];
    for (const [text, pos] of marks) {
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.16), this.basic(this.ticket(text)));
      tag.position.set(pos.x + 0.42, 1.42, pos.z);
      tag.rotation.y = -Math.PI / 2;
      const lever = meshBox(this.lit, 0.08, 0.28, 0.08, text.includes('禁止') ? 0x6a3030 : 0xc4b46a);
      lever.position.set(pos.x + 0.28, 1.15, pos.z);
      tagMode(lever, this.host.night, 8);
      this.root.add(tag, lever);
    }
  }

  private addProps(): void {
    const chair = meshBox(this.lit, 0.46, 0.5, 0.46, 0x3a342c);
    chair.position.set(STATION.chair.x, 0.46, STATION.chair.z);
    const back = meshBox(this.lit, 0.46, 0.55, 0.08, 0x2a2622);
    back.position.set(STATION.chair.x, 0.9, STATION.chair.z - 0.18);
    const tape = meshBox(this.lit, 0.12, 0.08, 0.12, 0xd7c36a);
    tape.position.set(STATION.chair.x + 0.2, 0.74, STATION.chair.z);
    tagMode(chair, this.host.night, 8);
    tagMode(back, this.host.night, 8);
    this.root.add(chair, back, tape);
    const phone = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.12), this.basic(this.ticket('未读')));
    phone.position.set(STATION.phone.x, 0.82, STATION.phone.z);
    phone.rotation.x = -Math.PI / 2;
    this.root.add(phone);
    const roster = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), this.basic(this.roster()));
    roster.position.set(-2.35, 1.55, 9.15);
    roster.rotation.y = Math.PI;
    const stand = meshBox(this.lit, 0.08, 1.3, 0.08, 0x2a3036);
    stand.position.set(-2.35, 0.65, 9.28);
    this.root.add(roster, stand);
    const ext = meshBox(this.lit, 0.18, 0.55, 0.18, 0x8a2a2a);
    ext.position.set(STATION.extinguisher.x, 1.15, STATION.extinguisher.z);
    const blow = meshBox(this.lit, 0.35, 0.28, 0.7, 0x4a4038);
    blow.position.set(STATION.blower.x, 0.9, STATION.blower.z);
    tagMode(blow, this.host.night, 8);
    this.root.add(ext, blow);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 8), this.lit);
    paint(cup.geometry, new THREE.Color(0x6a5038));
    cup.position.set(STATION.tea.x, 0.62, STATION.tea.z);
    this.root.add(cup);
  }

  private addLamps(): void {
    this.emergency = emissiveMaterial(0xff3a2a, 1.6);
    this.deskLamp = emissiveMaterial(0xffc48a, 1.4);
    const emerg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.16), this.emergency);
    emerg.position.set(0.2, 3.05, 23.2);
    const porch = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), this.emergency);
    porch.position.set(0, 2.85, 7.68);
    const desk = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), this.deskLamp);
    desk.position.set(STATION.phone.x, 1.05, STATION.phone.z - 0.15);
    const shade = meshBox(this.lit, 0.22, 0.08, 0.22, 0x2a241c);
    shade.position.set(STATION.phone.x, 1.16, STATION.phone.z - 0.15);
    this.root.add(emerg, porch, desk, shade);
    for (const z of STATION.lamps) {
      const pole = meshBox(this.lit, 0.1, 5.2, 0.1, 0x2a3036);
      pole.position.set(6.35, 2.6, z);
      const arm = meshBox(this.lit, 0.7, 0.06, 0.06, 0x2a3036);
      arm.position.set(6.7, 5.05, z);
      const mat = emissiveMaterial(0xff9a3a, 0.02);
      this.sodiums.push(mat);
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mat);
      globe.position.set(7.05, 4.95, z);
      tagMode(pole, this.host.night, 8);
      this.root.add(pole, arm, globe);
    }
  }

  private addInsulators(): void {
    const positions = [
      [-8.4, 6.2],
      [-3.4, 6.0],
      [3.6, 6.1],
      [8.2, 6.3],
    ];
    for (const [x, z] of positions) {
      const post = meshBox(this.lit, 0.18, 2.4, 0.18, 0x3a4048);
      post.position.set(x, 1.2, z);
      tagMode(post, this.host.night, 8);
      this.root.add(post);
      for (let i = 0; i < 4; i++) {
        const bell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), this.lit);
        paint(bell.geometry, new THREE.Color(0.75, 0.82, 0.86));
        bell.scale.y = 0.7;
        bell.position.set(x, 1.7 + i * 0.28, z);
        tagMode(bell, this.host.night, 3);
        this.root.add(bell);
      }
    }
    const bush = new THREE.ConeGeometry(0.35, 0.7, 5);
    bush.translate(0, 0.3, 0);
    paint(bush, new THREE.Color(0xd7e0e6));
    const mesh = new THREE.InstancedMesh(bush, this.lit, 18);
    const dummy = new THREE.Object3D();
    let n = 0;
    for (let i = 0; i < 18; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      dummy.position.set(side * (8 + (i % 5) * 0.4), 0, 1.2 + i * 0.35);
      dummy.scale.set(0.8, 0.5 + (i % 3) * 0.2, 0.8);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      n += 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    tagMode(mesh, this.host.night, 2);
    this.root.add(mesh);
  }

  private addHospital(): void {
    const heights = [11, 16, 9, 13];
    heights.forEach((height, index) => {
      const block = meshBox(this.lit, 6.5, height, 7, 0x10141a);
      block.position.set(6 + index * 2.2, height / 2, 64 + (index % 2) * 3);
      tagMode(block, this.host.night, 7);
      this.root.add(block);
    });
    this.hospitalWins = emissiveMaterial(0xffb070, 0.04);
    for (let i = 0; i < 12; i++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.8), this.hospitalWins);
      win.position.set(3.6 + (i % 4) * 3.2, 4.2 + Math.floor(i / 4) * 3.1, 60.2);
      win.rotation.y = Math.PI;
      this.root.add(win);
    }
  }

  private addPipes(): void {
    for (const z of [10.5, 16.2, 22.4]) {
      const pipe = meshBox(this.lit, 0.1, 0.1, 6.5, 0x4a545c);
      pipe.position.set(-10.7, 2.55, z);
      pipe.rotation.y = 0.04;
      tagMode(pipe, this.host.night, 8);
      const ice = meshBox(this.lit, 0.14, 0.06, 1.2, 0xd5e6ee);
      ice.position.set(-10.7, 2.62, z - 1.4);
      tagMode(ice, this.host.night, 3);
      this.root.add(pipe, ice);
    }
  }

  private basic(tex: THREE.Texture): THREE.MeshBasicMaterial {
    tex.colorSpace = THREE.NoColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  }

  private ticket(text: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (!ctx) return this.keep(canvas);
    ctx.fillStyle = '#1a140c';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#f0e2b8';
    ctx.font = '40px "WenQuanYi Micro Hei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 50);
    return this.keep(canvas);
  }

  private label(lines: string[], w: number, h: number): THREE.CanvasTexture {
    void w;
    void h;
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    if (!ctx) return this.keep(canvas);
    ctx.fillStyle = '#14181c';
    ctx.fillRect(0, 0, 768, 320);
    ctx.strokeStyle = '#c5b48a';
    ctx.lineWidth = 6;
    ctx.strokeRect(12, 12, 744, 296);
    ctx.fillStyle = '#f3ead2';
    ctx.textAlign = 'center';
    ctx.font = '42px "WenQuanYi Micro Hei", sans-serif';
    lines.forEach((line, index) => {
      if (line.includes('禁止')) ctx.fillStyle = '#e07070';
      else ctx.fillStyle = '#f3ead2';
      ctx.fillText(line, 384, 80 + index * 78);
    });
    return this.keep(canvas);
  }

  private roster(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    if (!ctx) return this.keep(canvas);
    ctx.fillStyle = '#d9d1c2';
    ctx.fillRect(0, 0, 320, 420);
    ctx.fillStyle = '#2a241c';
    ctx.font = '36px "WenQuanYi Micro Hei", sans-serif';
    ctx.fillText('夜班', 28, 64);
    ctx.fillText('林肖', 28, 130);
    ctx.strokeStyle = '#2a241c';
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 3;
    for (const y of [190, 250, 310]) {
      ctx.beginPath();
      ctx.moveTo(28, y);
      ctx.bezierCurveTo(80, y - 8, 140, y + 10, 250, y);
      ctx.stroke();
    }
    return this.keep(canvas);
  }

  private keep(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    this.textures.push(tex);
    return tex;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
