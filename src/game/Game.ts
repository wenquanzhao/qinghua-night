import * as THREE from 'three';
import { AudioBus } from './audio';
import { CHAPTERS, createChapter } from './chapters/registry';
import { Input } from './input';
import { stationCheckpoint, type Kit } from './kit';
import { loadProgress, markCleared } from './progress';
import { formatClock } from './rules';
import { loadSettings, saveSettings, type Settings } from './settings';
import type { Chapter, Host, Report } from './types';
import { Shell } from './ui';
import { Film } from '../render/film';
import { PROFILES, NightField, Snow, createSky, detectQuality, type QualityProfile } from '../render/night';

type Mode = 'title' | 'briefing' | 'playing' | 'paused' | 'interrupt' | 'boundary';
type Overlay = 'title' | 'paused';

const SETTINGS_KEY = 'qinghua-night-settings-v1';

export class Game implements Host {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly night = new NightField();
  readonly input: Input;
  readonly audio = new AudioBus();
  settings: Settings;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly snow: Snow;
  private readonly sky: THREE.Mesh;
  private readonly shell: Shell;
  private readonly film: Film;
  private chapter: Chapter | null = null;
  private chapterId = 'south-road';
  private entryKit: Kit | null = null;
  private crossing = false;
  private pendingId: string | null = null;
  private cut = 0;
  private mode: Mode = 'title';
  private overlayFrom: Overlay = 'title';
  private survival = 0;
  private sawLock = false;
  private lines: { who: string; text: string; left: number }[] = [];
  private hintText = '';
  private hintLeft = 0;
  private damage = 0;
  private sized = { w: 0, h: 0, scale: 0 };

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement, touch: HTMLElement) {
    const saved = localStorage.getItem(SETTINGS_KEY);
    this.settings = loadSettings();
    if (!saved) this.settings.quality = detectQuality();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.08, 320);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x07090c, 1);
    this.renderer.setPixelRatio(1);
    this.input = new Input(canvas, touch, this.settings);
    this.audio.setVolume(this.settings.volume);
    this.sky = createSky(this.night);
    this.snow = new Snow(this.night, 1400);
    this.scene.add(this.sky, this.snow.points);
    this.film = new Film(this.night);
    this.shell = new Shell(ui, {
      start: () => this.start(),
      depart: () => this.depart(),
      resume: () => this.resume(),
      retry: () => this.retry(),
      title: () => this.toTitle(),
      replay: () => this.retry(),
      open: (name) => this.openOverlay(name),
      back: () => this.back(),
      setQuality: (quality) => this.changeQuality(quality),
      setNumber: (key, value) => this.changeNumber(key, value),
      setInvert: (value) => this.changeInvert(value),
      fullscreen: () => this.toggleFullscreen(),
      pickChapter: (id) => this.pickChapter(id),
    });
    this.shell.show('title');
    this.shell.chapters(loadProgress().cleared);
    this.shell.bindSettings(this.settings);
    this.applyQuality(true);
    window.addEventListener('resize', () => this.applyQuality(true));
    document.addEventListener('fullscreenchange', () => this.shell.bindSettings(this.settings));
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && this.mode === 'briefing') this.depart();
    });
    this.frame(performance.now());
  }

  get quality(): QualityProfile {
    return PROFILES[this.settings.quality];
  }

  say(who: string, text: string, seconds: number): void {
    this.lines.push({ who, text, left: seconds });
  }

  hint(text: string, seconds: number): void {
    this.hintText = text;
    this.hintLeft = seconds;
  }

  busy(): boolean {
    return this.lines.length > 0;
  }

  setDamage(amount: number): void {
    this.damage = amount;
    this.night.damage = amount;
  }

  private start(): void {
    this.audio.resume();
    this.audio.wind(true);
    this.entryKit = null;
    this.crossing = false;
    this.pendingId = null;
    this.cut = 0;
    this.mountChapter('south-road');
    this.survival = 0;
    this.lines = [];
    this.hintText = '';
    this.mode = 'briefing';
    this.shell.show('briefing');
  }

  private depart(): void {
    if (this.mode !== 'briefing') return;
    this.survival = 0;
    this.mode = 'playing';
    this.sawLock = false;
    this.input.setGameplay(true);
    this.input.requestLock();
    this.shell.show('hud');
  }

  private resume(): void {
    if (this.mode !== 'paused') return;
    this.mode = 'playing';
    this.input.setGameplay(true);
    this.input.requestLock();
    this.shell.show('hud');
  }

  private pause(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.sawLock = false;
    this.input.setGameplay(false);
    this.input.exitLock();
    this.shell.show('pause');
  }

  private retry(): void {
    this.audio.resume();
    this.crossing = false;
    this.pendingId = null;
    this.cut = 0;
    const kit = this.chapterId === 'substation' ? (this.entryKit ?? stationCheckpoint()) : undefined;
    this.mountChapter(this.chapterId, kit);
    this.survival = 0;
    this.lines = [];
    this.hintText = '';
    this.mode = 'playing';
    this.sawLock = false;
    this.input.setGameplay(true);
    this.input.requestLock();
    this.shell.show('hud');
  }

  private toTitle(): void {
    this.chapter?.dispose();
    this.chapter = null;
    this.crossing = false;
    this.pendingId = null;
    this.cut = 0;
    this.lines = [];
    this.hintText = '';
    this.mode = 'title';
    this.input.setGameplay(false);
    this.input.exitLock();
    this.night.zero();
    this.audio.engine('off');
    this.shell.show('title');
  }

  private openOverlay(name: 'chapters' | 'settings' | 'help'): void {
    if (this.mode === 'playing') return;
    this.overlayFrom = this.mode === 'paused' ? 'paused' : 'title';
    if (name === 'chapters') this.shell.chapters(loadProgress().cleared);
    if (name === 'settings') this.shell.bindSettings(this.settings);
    this.shell.show(name);
  }

  private back(): void {
    this.shell.show(this.overlayFrom === 'paused' ? 'pause' : 'title');
    if (this.overlayFrom === 'paused') this.mode = 'paused';
    else this.mode = 'title';
  }

  private pickChapter(id: string): void {
    const meta = CHAPTERS.find((item) => item.id === id);
    const progress = loadProgress();
    if (!meta?.playable || !progress.cleared.includes(id)) return;
    this.audio.resume();
    this.audio.wind(true);
    this.crossing = false;
    this.pendingId = null;
    this.cut = 0;
    const kit = id === 'substation' ? stationCheckpoint() : undefined;
    this.entryKit = kit ?? null;
    this.mountChapter(id, kit);
    this.survival = 0;
    this.lines = [];
    this.mode = 'playing';
    this.sawLock = false;
    this.input.setGameplay(true);
    this.input.requestLock();
    this.shell.show('hud');
  }

  private mountChapter(id: string, kit?: Kit): void {
    this.chapter?.dispose();
    this.night.resetMood();
    this.chapterId = id;
    this.chapter = createChapter(id, this, kit);
    this.chapter.mount();
  }

  private changeQuality(quality: Settings['quality']): void {
    this.settings.quality = quality;
    this.persist();
    this.applyQuality(true);
    this.shell.bindSettings(this.settings);
  }

  private changeNumber(key: 'sensitivity' | 'volume' | 'fov', value: number): void {
    this.settings[key] = value;
    if (key === 'volume') this.audio.setVolume(value);
    if (key === 'fov') {
      this.camera.fov = value;
      this.camera.updateProjectionMatrix();
    }
    this.persist();
  }

  private changeInvert(value: boolean): void {
    this.settings.invertY = value;
    this.persist();
  }

  private persist(): void {
    saveSettings(this.settings);
  }

  private toggleFullscreen(): void {
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.();
    else void document.exitFullscreen?.();
  }

  private applyQuality(force: boolean): void {
    const canvas = this.renderer.domElement;
    const profile = this.quality;
    const cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
    if (!force && this.sized.w === cssW && this.sized.h === cssH && this.sized.scale === profile.scale) return;
    this.sized = { w: cssW, h: cssH, scale: profile.scale };
    this.camera.aspect = cssW / cssH;
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.snow.setCount(profile.snow);
    this.renderer.setSize(cssW, cssH, false);
    this.renderer.setPixelRatio(1);
    this.film.resize(cssW, cssH, profile);
    this.night.uniforms.uDetail.value = profile.detail;
    this.night.uniforms.uVol.value = profile.vol;
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.applyQuality(false);
    if (this.mode === 'playing' && this.input.isLocked) this.sawLock = true;
    else if (this.mode === 'playing' && this.sawLock && !this.input.isLocked) this.pause();
    if (this.mode === 'playing' && this.chapter) {
      if (!this.crossing && this.input.consume('pause')) this.pause();
      if (this.mode === 'playing') {
        this.survival += dt;
        if (this.crossing) this.advance(dt);
        else {
          this.chapter.update(dt);
          const report = this.chapter.report();
          if (report.handoff) this.beginCross(report);
          else if (report.fail) this.showInterrupt(report);
          else if (report.complete) this.showBoundary(report);
          else this.paintHud();
        }
      }
    } else if ((this.mode === 'briefing' || this.mode === 'paused' || this.mode === 'interrupt' || this.mode === 'boundary') && this.chapter) {
      this.chapter.present(dt);
    } else {
      this.camera.position.set(0, 1.8, 4);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(6, 2.4, 36);
    }
    if (this.mode === 'playing' || this.mode === 'briefing') this.tickText(dt);
    this.night.time += dt;
    this.night.upload();
    this.sky.position.copy(this.camera.position);
    this.snow.points.position.copy(this.camera.position);
    this.snow.update(dt);
    if (!this.crossing && this.cut > 0) this.cut = Math.max(0, this.cut - dt * 1.35);
    this.render();
    this.shell.cut(this.cut);
    this.shell.vignette(this.damage > 0.25 && this.mode === 'playing');
  };

  private last = 0;

  private tickText(dt: number): void {
    const line = this.lines[0];
    if (line) {
      line.left -= dt;
      if (line.left <= 0) this.lines.shift();
    }
    if (this.hintLeft > 0) {
      this.hintLeft -= dt;
      if (this.hintLeft <= 0) this.hintText = '';
    }
  }

  private paintHud(): void {
    if (!this.chapter) return;
    const line = this.lines[0];
    this.shell.hud(
      this.chapter.report(),
      formatClock(this.survival),
      line ? { who: line.who, text: line.text } : null,
      this.hintText,
    );
  }

  private beginCross(report: Report): void {
    this.crossing = true;
    this.pendingId = report.handoff;
    this.entryKit = report.kit ?? stationCheckpoint();
    this.audio.engine('off');
    if (this.chapterId === 'south-road') markCleared('south-road');
    this.cut = Math.max(this.cut, 0.15);
  }

  private advance(dt: number): void {
    this.chapter?.present(dt);
    this.cut = Math.min(1, this.cut + dt * 1.8);
    if (this.cut < 1 || !this.pendingId) return;
    const id = this.pendingId;
    const kit = this.entryKit ?? stationCheckpoint();
    this.pendingId = null;
    this.crossing = false;
    this.lines = [];
    this.mountChapter(id, kit);
    this.paintHud();
  }

  private showInterrupt(report: Report): void {
    this.mode = 'interrupt';
    this.input.setGameplay(false);
    this.input.exitLock();
    const reason =
      report.fail === 'ditch' ? '掉进冰沟' : report.fail === 'fire' ? '站内起火' : report.fail === 'surrounded' ? '在主控室被围住' : '被击倒';
    this.shell.interrupt(reason, this.survival, report.objectives, report.place);
    this.shell.show('interrupt');
  }

  private showBoundary(report: Report): void {
    this.mode = 'boundary';
    this.input.setGameplay(false);
    this.input.exitLock();
    if (report.place.startsWith('第二章')) {
      markCleared('substation');
      this.shell.boundaryCard('辅路通了', '钠灯亮了一排。桥上情况不明。这一版停在辅路上。');
    } else {
      this.shell.boundaryCard('外门开了', '变压器在响。馈线还没送上。');
    }
    this.shell.show('boundary');
  }

  private render(): void {
    this.film.render(this.renderer, this.scene, this.camera, this.damage);
  }
}
