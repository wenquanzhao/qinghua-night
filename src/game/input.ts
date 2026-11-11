import type { Settings } from './settings';

export interface Snapshot {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
  interact: boolean;
  fire: boolean;
  melee: boolean;
  reload: boolean;
  flashlight: boolean;
  slot1: boolean;
  slot2: boolean;
  pause: boolean;
}

const LOOK_KEYS: Record<string, string> = {
  ArrowLeft: 'lookL',
  ArrowRight: 'lookR',
  ArrowUp: 'lookU',
  ArrowDown: 'lookD',
  KeyJ: 'lookL',
  KeyL: 'lookR',
  KeyI: 'lookU',
  KeyK: 'lookD',
};

const KEYS: Record<string, string> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyC: 'crouchToggle',
  ControlLeft: 'crouchHold',
  Space: 'jump',
  KeyE: 'interact',
  KeyR: 'reload',
  KeyF: 'flashlight',
  KeyV: 'melee',
  Digit1: 'slot1',
  Digit2: 'slot2',
  Escape: 'pause',
};

export class Input {
  private readonly down = new Set<string>();
  private readonly edges = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private gameplay = false;
  private locked = false;
  private crouchToggle = false;
  private padWas = new Set<string>();
  private touchIds = { stick: -1, look: -1 };
  private stick = { x: 0, y: 0, ox: 0, oy: 0 };
  private touchRoot: HTMLElement;
  private ignoreMouseUntil = 0;
  private padInteract = false;
  private padSprint = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    touchRoot: HTMLElement,
    private readonly settings: Settings,
  ) {
    this.touchRoot = touchRoot;
    this.buildTouch();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this.onLock);
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd);
    canvas.addEventListener('touchcancel', this.onTouchEnd);
    window.addEventListener('touchstart', this.noteTouch, { capture: true, passive: true });
  }

  setGameplay(on: boolean): void {
    this.gameplay = on;
    if (!on) {
      this.crouchToggle = false;
      this.clear();
    }
    this.touchRoot.hidden = !on || !document.documentElement.classList.contains('is-touch');
  }

  requestLock(): void {
    if (!this.canvas.requestPointerLock) return;
    const pending = this.canvas.requestPointerLock();
    if (pending && typeof (pending as Promise<void>).catch === 'function') {
      void (pending as Promise<void>).catch(() => undefined);
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get isLocked(): boolean {
    return this.locked;
  }

  consume(name: string): boolean {
    const hit = this.edges.has(name);
    this.edges.delete(name);
    return hit;
  }

  snapshot(dt: number): Snapshot {
    const sens = this.settings.sensitivity;
    const invert = this.settings.invertY ? -1 : 1;
    let moveX = (this.down.has('right') ? 1 : 0) - (this.down.has('left') ? 1 : 0);
    let moveY = (this.down.has('forward') ? 1 : 0) - (this.down.has('back') ? 1 : 0);
    moveX += this.stick.x;
    moveY += this.stick.y;
    const pad = this.readPad(dt, sens, invert);
    moveX += pad.x;
    moveY += pad.y;
    moveX = Math.max(-1, Math.min(1, moveX));
    moveY = Math.max(-1, Math.min(1, moveY));

    let lookX = this.lookDX * 0.00215 * sens;
    let lookY = this.lookDY * 0.00215 * sens * (this.settings.invertY ? 1 : -1);
    this.lookDX = 0;
    this.lookDY = 0;
    if (this.down.has('lookL')) lookX -= 1.45 * dt * sens;
    if (this.down.has('lookR')) lookX += 1.45 * dt * sens;
    if (this.down.has('lookU')) lookY += 1.05 * dt * sens * invert;
    if (this.down.has('lookD')) lookY -= 1.05 * dt * sens * invert;
    lookX += pad.lookX;
    lookY += pad.lookY;
    lookX = Math.max(-0.45, Math.min(0.45, lookX));
    lookY = Math.max(-0.45, Math.min(0.45, lookY));

    const take = (name: string) => {
      const hit = this.edges.has(name);
      this.edges.delete(name);
      return hit;
    };
    if (take('crouchToggle')) this.crouchToggle = !this.crouchToggle;
    const snap: Snapshot = {
      moveX,
      moveY,
      lookX,
      lookY,
      sprint: this.down.has('sprint') || this.padSprint,
      crouch: this.crouchToggle || this.down.has('crouchHold'),
      jump: take('jump'),
      interact: this.down.has('interact') || this.padInteract,
      fire: take('fire'),
      melee: take('melee'),
      reload: take('reload'),
      flashlight: take('flashlight'),
      slot1: take('slot1'),
      slot2: take('slot2'),
      pause: take('pause'),
    };
    return snap;
  }

  private readPad(dt: number, sens: number, invert: number): { x: number; y: number; lookX: number; lookY: number } {
    const out = { x: 0, y: 0, lookX: 0, lookY: 0 };
    this.padInteract = false;
    this.padSprint = false;
    const pads = navigator.getGamepads?.();
    if (!pads) return out;
    let pad: Gamepad | null = null;
    for (const candidate of pads) {
      if (candidate && candidate.connected && candidate.mapping === 'standard') {
        pad = candidate;
        break;
      }
    }
    if (!pad) {
      this.padWas.clear();
      return out;
    }
    const ax = (v: number) => {
      const a = Math.abs(v);
      if (a < 0.18) return 0;
      return Math.sign(v) * ((a - 0.18) / 0.82);
    };
    out.x = ax(pad.axes[0] || 0);
    out.y = -ax(pad.axes[1] || 0);
    const lx = ax(pad.axes[2] || 0);
    const ly = ax(pad.axes[3] || 0);
    out.lookX = lx * Math.abs(lx) * 2.1 * dt * sens;
    out.lookY = -ly * Math.abs(ly) * 1.5 * dt * sens * invert;
    const map: Record<number, string> = {
      0: 'jump',
      1: 'crouchToggle',
      2: 'reload',
      3: 'flashlight',
      4: 'melee',
      5: 'fire',
      7: 'fire',
      9: 'pause',
      10: 'sprint',
    };
    const now = new Set<string>();
    for (const key of Object.keys(map)) {
      const index = Number(key);
      const button = pad.buttons[index];
      const pressed = !!button && (button.pressed || button.value > 0.45);
      const name = map[index];
      if (pressed) now.add(name);
    }
    const trigger = pad.buttons[6];
    this.padInteract = !!trigger && (trigger.pressed || trigger.value > 0.45);
    this.padSprint = now.has('sprint');
    for (const name of now) {
      if (!this.padWas.has(name) && name !== 'sprint') this.edges.add(name);
    }
    this.padWas = now;
    return out;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const action = KEYS[event.code] ?? LOOK_KEYS[event.code];
    if (!action || !this.gameplay) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    if (event.repeat) return;
    if (action === 'jump' || action === 'reload' || action === 'flashlight' || action === 'melee' || action === 'pause' || action === 'slot1' || action === 'slot2' || action === 'crouchToggle') {
      this.edges.add(action);
    }
    this.down.add(action);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    const action = KEYS[event.code] ?? LOOK_KEYS[event.code];
    if (action) this.down.delete(action);
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (!this.gameplay || performance.now() < this.ignoreMouseUntil) return;
    if (!this.locked) {
      this.requestLock();
      return;
    }
    if (event.button === 0) this.edges.add('fire');
    if (event.button === 2) this.edges.add('melee');
  };

  private onMouseUp = (_event: MouseEvent): void => undefined;

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.gameplay || !this.locked) return;
    if (Math.abs(event.movementX) > 400 || Math.abs(event.movementY) > 400) return;
    this.lookDX += event.movementX;
    this.lookDY += event.movementY;
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.gameplay) return;
    event.preventDefault();
    this.edges.add(event.deltaY > 0 ? 'slot2' : 'slot1');
  };

  private onLock = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
  };

  private noteTouch = (): void => {
    document.documentElement.classList.add('is-touch');
    this.ignoreMouseUntil = performance.now() + 700;
    if (this.gameplay) this.touchRoot.hidden = false;
  };

  private onTouchStart = (event: TouchEvent): void => {
    if (!this.gameplay) return;
    event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.clientX < window.innerWidth * 0.46 && this.touchIds.stick < 0) {
        this.touchIds.stick = touch.identifier;
        this.stick.ox = touch.clientX;
        this.stick.oy = touch.clientY;
        this.placeStick(touch.clientX, touch.clientY, 0, 0, true);
      } else if (this.touchIds.look < 0) {
        this.touchIds.look = touch.identifier;
        this.lookOrigin(touch);
      }
    }
  };

  private lookOriginX = 0;
  private lookOriginY = 0;

  private lookOrigin(touch: Touch): void {
    this.lookOriginX = touch.clientX;
    this.lookOriginY = touch.clientY;
  }

  private onTouchMove = (event: TouchEvent): void => {
    if (!this.gameplay) return;
    event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === this.touchIds.stick) {
        let dx = touch.clientX - this.stick.ox;
        let dy = touch.clientY - this.stick.oy;
        const max = 64;
        const len = Math.hypot(dx, dy) || 1;
        if (len > max) {
          dx = (dx / len) * max;
          dy = (dy / len) * max;
        }
        this.stick.x = dx / max;
        this.stick.y = -dy / max;
        this.placeStick(this.stick.ox, this.stick.oy, dx, dy, true);
      } else if (touch.identifier === this.touchIds.look) {
        this.lookDX += touch.clientX - this.lookOriginX;
        this.lookDY += touch.clientY - this.lookOriginY;
        this.lookOriginX = touch.clientX;
        this.lookOriginY = touch.clientY;
      }
    }
  };

  private onTouchEnd = (event: TouchEvent): void => {
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === this.touchIds.stick) {
        this.touchIds.stick = -1;
        this.stick.x = 0;
        this.stick.y = 0;
        this.placeStick(0, 0, 0, 0, false);
      }
      if (touch.identifier === this.touchIds.look) this.touchIds.look = -1;
    }
  };

  private placeStick(x: number, y: number, dx: number, dy: number, on: boolean): void {
    const stick = this.touchRoot.querySelector('.stick') as HTMLElement | null;
    const nub = this.touchRoot.querySelector('.nub') as HTMLElement | null;
    if (!stick || !nub) return;
    stick.classList.toggle('on', on);
    if (!on) return;
    stick.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    nub.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  }

  private buildTouch(): void {
    this.touchRoot.className = 'touch';
    this.touchRoot.innerHTML = `
      <div class="stick"><i class="nub"></i></div>
      <div class="touch-buttons"></div>
    `;
    const bar = this.touchRoot.querySelector('.touch-buttons') as HTMLElement;
    const specs: [string, string][] = [
      ['interact', '互动'],
      ['fire', '射击'],
      ['melee', '近战'],
      ['jump', '跳'],
      ['crouchToggle', '蹲'],
      ['reload', '换弹'],
      ['flashlight', '头灯'],
      ['sprint', '冲刺'],
      ['pause', '暂停'],
    ];
    for (const [action, label] of specs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('touchstart', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.ignoreMouseUntil = performance.now() + 700;
        if (action === 'sprint' || action === 'interact') this.down.add(action);
        else this.edges.add(action);
        button.classList.add('on');
      }, { passive: false });
      const release = (event: Event) => {
        event.preventDefault();
        if (action === 'sprint' || action === 'interact') this.down.delete(action);
        button.classList.remove('on');
      };
      button.addEventListener('touchend', release);
      button.addEventListener('touchcancel', release);
      bar.appendChild(button);
    }
  }

  private clear = (): void => {
    this.down.clear();
    this.edges.clear();
    this.lookDX = 0;
    this.lookDY = 0;
    this.stick.x = 0;
    this.stick.y = 0;
    this.padInteract = false;
    this.padSprint = false;
    this.touchIds.stick = -1;
    this.touchIds.look = -1;
  };
}
