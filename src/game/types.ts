import type * as THREE from 'three';
import type { AudioBus } from './audio';
import type { Input } from './input';
import type { Kit } from './kit';
import type { Settings } from './settings';
import type { NightField, QualityProfile } from '../render/night';

export interface Host {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  night: NightField;
  input: Input;
  audio: AudioBus;
  settings: Settings;
  readonly quality: QualityProfile;
  say(who: string, text: string, seconds: number): void;
  hint(text: string, seconds: number): void;
  busy(): boolean;
  setDamage(amount: number): void;
}

export interface Objective {
  id: string;
  text: string;
  done: boolean;
}

export interface Report {
  primary: string;
  objectives: Objective[];
  health: number;
  weapon: string;
  ammoIn: number;
  ammoReserve: number;
  showAmmo: boolean;
  lightOn: boolean;
  prompt: string;
  hold: number;
  riding: boolean;
  fail: null | 'down' | 'ditch' | 'fire' | 'surrounded';
  complete: boolean;
  /** Set for one report once the next chapter should mount. */
  handoff: null | 'substation';
  /** Gear at the moment of a handoff. Null while staying in the chapter. */
  kit: Kit | null;
  place: string;
  crosshair: boolean;
  debug: string;
}

export interface Chapter {
  mount(): void;
  update(dt: number): void;
  present(dt: number): void;
  dispose(): void;
  report(): Report;
}
