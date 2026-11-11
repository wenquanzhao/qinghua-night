import { CHAPTERS, type ChapterMeta } from './chapters/registry';
import { formatDuration } from './rules';
import type { Settings } from './settings';
import type { Objective, Report } from './types';

const BRIEFING =
  '调度把我从值班室叫起来。南岸整片黑了，馈线跳闸，卫生院只剩自己的发电机。渡在那边值夜班，电话打不通。他们要我先把南岸变电站送上电，再过桥。雪还在下。';

export interface ShellHandlers {
  start: () => void;
  depart: () => void;
  resume: () => void;
  retry: () => void;
  title: () => void;
  replay: () => void;
  open: (name: 'chapters' | 'settings' | 'help') => void;
  back: () => void;
  setQuality: (quality: Settings['quality']) => void;
  setNumber: (key: 'sensitivity' | 'volume' | 'fov', value: number) => void;
  setInvert: (value: boolean) => void;
  fullscreen: () => void;
  pickChapter: (id: string) => void;
}

export class Shell {
  private readonly screens = new Map<string, HTMLElement>();
  private readonly debugOn = location.hash === '#debug';

  constructor(
    root: HTMLElement,
    private readonly handlers: ShellHandlers,
  ) {
    root.innerHTML = `
      <div class="vignette"></div>
      <section class="screen title" data-screen="title"></section>
      <section class="screen brief-wrap" data-screen="briefing"></section>
      <section class="screen" data-screen="chapters"></section>
      <section class="screen" data-screen="settings"></section>
      <section class="screen" data-screen="help"></section>
      <section class="screen hud" data-screen="hud"></section>
      <section class="screen" data-screen="pause"></section>
      <section class="screen" data-screen="interrupt"></section>
      <section class="screen" data-screen="boundary"></section>
    `;
    for (const node of root.querySelectorAll<HTMLElement>('[data-screen]')) {
      this.screens.set(node.dataset.screen || '', node);
    }
    this.screens.get('title')!.innerHTML = `
      <div class="plate title-plate">
        <div class="kicker">青桦县 · 夜班</div>
        <h1>青桦一夜</h1>
        <p class="tagline">南岸馈线故障 · 02:17</p>
        <button class="act" data-go="start">开始行动</button>
        <button class="act" data-open="chapters">章节选择</button>
        <button class="act" data-open="settings">设置</button>
        <button class="act" data-open="help">操作说明</button>
        <div class="ver">v0.1</div>
      </div>`;
    this.screens.get('briefing')!.innerHTML = `
      <div class="plate brief">
        <div class="kicker">林肖</div>
        <p>${BRIEFING}</p>
        <button class="act" data-go="depart">出发</button>
      </div>`;
    this.screens.get('pause')!.innerHTML = `
      <div class="plate menu">
        <h2>暂停</h2>
        <button class="act" data-go="resume">继续</button>
        <button class="act" data-open="settings">设置</button>
        <button class="act" data-open="help">操作说明</button>
        <button class="act" data-go="title">返回标题</button>
      </div>`;
    this.screens.get('hud')!.innerHTML = `
      <div class="hud-top">
        <div class="kicker">第一章 · 南岸公路</div>
        <div class="objective"></div>
      </div>
      <div class="clock"></div>
      <div class="crosshair" hidden></div>
      <div class="prompt" hidden><span></span><i class="hold"><i></i></i></div>
      <div class="sub" hidden><b></b><span></span></div>
      <div class="hint" hidden></div>
      <div class="hud-bottom">
        <div class="health" hidden><i></i></div>
        <div class="gear"><span class="weapon"></span><span class="ammo"></span><span class="lamp"></span></div>
      </div>
      <div class="debug" hidden></div>`;
    this.screens.get('help')!.innerHTML = `
      <div class="plate menu help">
        <h2>操作说明</h2>
        <p>键鼠：WASD 移动，Shift 冲刺，C 蹲下，Ctrl 按住蹲下，空格跳。鼠标转向。按 E 上下车。按住 E 搜寻、扳门，按住时画面上会有进度条。左键射击或徒手，右键或 V 近战，R 换弹，F 头灯，1 / 2 切换武器，滚轮换武器，Esc 暂停。</p>
        <p>方向键或 IJKL 也可以转向，不锁定鼠标时用这组键。</p>
        <p>手柄：左摇杆移动，右摇杆转向。A 跳，B 蹲，X 换弹，Y 头灯，LB 近战，RB 或 RT 射击，LT 点按上下车，按住 LT 搜寻或扳门，L3 冲刺，Start 暂停。</p>
        <p>触屏：点按屏幕后出现摇杆和按钮。点按「互动」上下车，按住「互动」搜寻或扳门。射击、近战、跳、蹲、换弹、头灯、冲刺、暂停。</p>
        <p>路上的人可以绕开，也可以停车。撞上去，车就废了。桥前的冰会让车熄火。掉进冰沟，或被击倒，这一趟就中断。低画质仍可完整游玩。</p>
        <button class="act" data-go="back">返回</button>
      </div>`;
    this.screens.get('interrupt')!.innerHTML = `
      <div class="plate center-card">
        <h2>中断</h2>
        <p class="reason"></p>
        <p class="time"></p>
        <p class="where">第一章 · 南岸公路</p>
        <div class="done"></div>
        <button class="act" data-go="retry">从本章重来</button>
        <button class="act" data-go="title">从头开始</button>
      </div>`;
    this.screens.get('boundary')!.innerHTML = `
      <div class="plate center-card">
        <div class="kicker">南岸变电站</div>
        <h2>外门开了</h2>
        <p>变压器在响。馈线还没送上。</p>
        <button class="act" data-go="replay">再走一遍</button>
        <button class="act" data-go="title">返回标题</button>
      </div>`;
    this.buildSettings();
    root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const go = target.closest<HTMLElement>('[data-go]')?.dataset.go;
      const open = target.closest<HTMLElement>('[data-open]')?.dataset.open;
      if (go === 'start') this.handlers.start();
      if (go === 'depart') this.handlers.depart();
      if (go === 'resume') this.handlers.resume();
      if (go === 'retry') this.handlers.retry();
      if (go === 'title') this.handlers.title();
      if (go === 'replay') this.handlers.replay();
      if (go === 'back') this.handlers.back();
      if (open === 'chapters' || open === 'settings' || open === 'help') this.handlers.open(open);
    });
  }

  show(name: string): void {
    for (const [key, node] of this.screens) node.classList.toggle('on', key === name);
  }

  vignette(hurt: boolean): void {
    document.querySelector('.vignette')?.classList.toggle('hurt', hurt);
  }

  chapters(cleared: string[]): void {
    const host = this.screens.get('chapters')!;
    const rows = CHAPTERS.map((chapter) => this.chapterRow(chapter, cleared)).join('');
    host.innerHTML = `
      <div class="plate menu">
        <h2>章节选择</h2>
        ${rows}
        <button class="act" data-go="back">返回</button>
      </div>`;
    host.querySelectorAll<HTMLButtonElement>('[data-chapter]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.chapter;
        if (id) this.handlers.pickChapter(id);
      });
    });
  }

  bindSettings(settings: Settings): void {
    const root = this.screens.get('settings')!;
    root.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((button) => {
      button.classList.toggle('on', button.dataset.quality === settings.quality);
    });
    const sens = root.querySelector<HTMLInputElement>('[data-key="sensitivity"]');
    const volume = root.querySelector<HTMLInputElement>('[data-key="volume"]');
    const fov = root.querySelector<HTMLInputElement>('[data-key="fov"]');
    const invert = root.querySelector<HTMLInputElement>('[data-key="invert"]');
    if (sens) sens.value = String(settings.sensitivity);
    if (volume) volume.value = String(settings.volume);
    if (fov) fov.value = String(settings.fov);
    if (invert) invert.checked = settings.invertY;
    const full = root.querySelector<HTMLButtonElement>('[data-full]');
    if (full) full.textContent = document.fullscreenElement ? '退出全屏' : '进入全屏';
  }

  hud(report: Report, clock: string, line: { who: string; text: string } | null, hint: string): void {
    const root = this.screens.get('hud')!;
    const objective = root.querySelector('.objective');
    if (objective) objective.textContent = report.primary;
    const clockNode = root.querySelector('.clock');
    if (clockNode) clockNode.textContent = clock;
    const cross = root.querySelector<HTMLElement>('.crosshair');
    if (cross) cross.hidden = !report.crosshair;
    const prompt = root.querySelector<HTMLElement>('.prompt');
    if (prompt) {
      prompt.hidden = !report.prompt;
      const label = prompt.querySelector('span');
      if (label) label.textContent = report.prompt;
      const bar = prompt.querySelector<HTMLElement>('.hold');
      const fill = prompt.querySelector<HTMLElement>('.hold i');
      if (bar && fill) {
        bar.hidden = report.hold < 0;
        fill.style.width = `${Math.max(0, report.hold) * 100}%`;
      }
    }
    const sub = root.querySelector<HTMLElement>('.sub');
    if (sub) {
      sub.hidden = !line;
      const who = sub.querySelector('b');
      const text = sub.querySelector('span');
      if (who) who.textContent = line?.who ?? '';
      if (text) text.textContent = line?.text ?? '';
      if (who) who.hidden = !line?.who;
    }
    const hintNode = root.querySelector<HTMLElement>('.hint');
    if (hintNode) {
      hintNode.hidden = !hint;
      hintNode.textContent = hint;
    }
    const health = root.querySelector<HTMLElement>('.health');
    const fill = root.querySelector<HTMLElement>('.health i');
    if (health && fill) {
      health.hidden = report.riding;
      fill.style.width = `${Math.max(0, report.health)}%`;
    }
    const weapon = root.querySelector('.weapon');
    const ammo = root.querySelector('.ammo');
    const lamp = root.querySelector('.lamp');
    if (weapon) weapon.textContent = report.riding ? '' : report.weapon;
    if (ammo) ammo.textContent = !report.riding && report.showAmmo ? `${report.ammoIn} | ${report.ammoReserve}` : '';
    if (lamp) lamp.textContent = !report.riding && report.lightOn ? '头灯' : '';
    const debug = root.querySelector<HTMLElement>('.debug');
    if (debug) {
      debug.hidden = !this.debugOn;
      debug.textContent = report.debug;
    }
  }

  interrupt(reason: string, seconds: number, done: Objective[]): void {
    const root = this.screens.get('interrupt')!;
    const reasonNode = root.querySelector('.reason');
    const timeNode = root.querySelector('.time');
    const list = root.querySelector('.done');
    if (reasonNode) reasonNode.textContent = reason;
    if (timeNode) timeNode.textContent = `生存 ${formatDuration(seconds)}`;
    if (list) {
      const finished = done.filter((item) => item.done);
      list.innerHTML = finished.length
        ? finished.map((item) => `<p>${item.text}</p>`).join('')
        : '<p class="muted">还没有完成的目标</p>';
    }
  }

  private chapterRow(chapter: ChapterMeta, cleared: string[]): string {
    const open = chapter.playable && cleared.includes(chapter.id);
    if (open) {
      return `<div class="chapter-row"><span><strong>${chapter.label}</strong> ${chapter.name}</span><button class="act" data-chapter="${chapter.id}">进入</button></div>`;
    }
    const note = chapter.playable ? '未解锁' : '未开放';
    return `<div class="chapter-row"><span><strong>${chapter.label}</strong> ${chapter.name}</span><span>${note}</span></div>`;
  }

  private buildSettings(): void {
    const root = this.screens.get('settings')!;
    root.innerHTML = `
      <div class="plate menu">
        <h2>设置</h2>
        <div class="row"><span>画质</span><span class="seg">
          <button class="act" data-quality="low">低</button>
          <button class="act" data-quality="mid">中</button>
          <button class="act" data-quality="high">高</button>
        </span></div>
        <p class="muted">低画质仍可完整游玩。</p>
        <label class="row"><span>灵敏度</span><input data-key="sensitivity" type="range" min="0.2" max="3" step="0.05" /></label>
        <label class="row"><span>反转 Y 轴</span><input data-key="invert" type="checkbox" /></label>
        <label class="row"><span>音量</span><input data-key="volume" type="range" min="0" max="1" step="0.05" /></label>
        <label class="row"><span>视野</span><input data-key="fov" type="range" min="60" max="100" step="1" /></label>
        <button class="act" data-full type="button">进入全屏</button>
        <button class="act" data-go="back">返回</button>
      </div>`;
    root.addEventListener('click', (event) => {
      const quality = (event.target as HTMLElement).closest<HTMLElement>('[data-quality]')?.dataset.quality;
      if (quality === 'low' || quality === 'mid' || quality === 'high') this.handlers.setQuality(quality);
      if ((event.target as HTMLElement).closest('[data-full]')) this.handlers.fullscreen();
    });
    root.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      const key = input.dataset.key;
      if (key === 'sensitivity' || key === 'volume' || key === 'fov') this.handlers.setNumber(key, Number(input.value));
      if (key === 'invert') this.handlers.setInvert(input.checked);
    });
  }
}
