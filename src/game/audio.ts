export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  volume = 0.7;

  resume(): void {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  setVolume(value: number): void {
    this.volume = value;
    if (this.master) this.master.gain.value = value;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);
    const wind = ctx.createGain();
    wind.gain.value = 0.0;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(2, ctx);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    src.connect(filter);
    filter.connect(wind);
    wind.connect(master);
    src.start();
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 52;
    const eg = ctx.createGain();
    eg.gain.value = 0;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 180;
    osc.connect(low);
    low.connect(eg);
    eg.connect(master);
    osc.start();
    this.ctx = ctx;
    this.master = master;
    this.windGain = wind;
    this.engineGain = eg;
    this.engineOsc = osc;
      return ctx;
    } catch {
      return null;
    }
  }

  wind(on: boolean): void {
    if (!this.windGain) return;
    this.windGain.gain.value = on ? 0.045 : 0;
  }

  engine(mode: 'off' | 'idle' | 'drive', speed = 0): void {
    if (!this.ensure() || !this.engineGain || !this.engineOsc) return;
    if (mode === 'off') {
      this.engineGain.gain.value = 0;
      return;
    }
    this.engineGain.gain.value = mode === 'drive' ? 0.03 : 0.018;
    this.engineOsc.frequency.value = 48 + Math.min(40, speed * 3.2);
  }

  shot(): void {
    this.burst(180, 0.18, 900, 0.22);
  }

  dry(): void {
    this.burst(1400, 0.03, 200, 0.04);
  }

  thud(): void {
    this.burst(90, 0.12, 180, 0.16);
  }

  swing(): void {
    this.burst(240, 0.05, 500, 0.05);
  }

  breath(): void {
    this.burst(180, 0.16, 300, 0.05);
  }

  radio(): void {
    this.burst(740, 0.06, 1400, 0.07);
  }

  stall(): void {
    this.burst(70, 0.28, 140, 0.12);
  }

  foot(): void {
    this.burst(160, 0.04, 220, 0.03);
  }

  discharge(): void {
    this.burst(55, 0.45, 90, 0.1);
  }

  click(): void {
    this.burst(880, 0.03, 1200, 0.04);
  }

  alarm(): void {
    this.burst(96, 0.42, 520, 0.14);
  }

  spray(): void {
    this.burst(520, 0.18, 2400, 0.07);
  }

  arc(): void {
    this.burst(140, 0.16, 1800, 0.1);
  }

  hurt(): void {
    this.burst(120, 0.1, 200, 0.08);
  }

  private burst(freq: number, dur: number, noiseFreq: number, gain: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    const src = ctx.createBufferSource();
    src.buffer = this.noise(dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = noiseFreq;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.7, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private noise(seconds: number, ctx: AudioContext | null = this.ctx): AudioBuffer {
    if (!ctx) throw new Error('音频还没准备好');
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
