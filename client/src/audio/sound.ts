import type { WeaponId } from '../../../shared/weapons';

const DEFAULT_MASTER_VOLUME = 0.7;
const DEFAULT_EFFECTS_VOLUME = 0.8;

export class SoundSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private disposed = false;
  private masterVolume = DEFAULT_MASTER_VOLUME;
  private effectsVolume = DEFAULT_EFFECTS_VOLUME;

  resume(): void {
    if (this.disposed) {
      return;
    }

    if (this.context === null) {
      try {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.65 * this.masterVolume;
        this.master.connect(this.context.destination);
        this.effects = this.context.createGain();
        this.effects.gain.value = this.effectsVolume;
        this.effects.connect(this.master);
        this.noiseBuffer = this.createNoiseBuffer(this.context);
      } catch {
        this.context = null;
        this.master = null;
        this.effects = null;
        this.noiseBuffer = null;
        return;
      }
    }

    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => undefined);
    }
  }

  shot(weapon: WeaponId, distance = 0): void {
    const audio = this.ensure();
    if (audio === null) {
      return;
    }

    const closeness = 1 / (1 + Math.max(0, distance) * 0.035);
    const isHeavy =
      weapon === 'awp' || weapon === 'ak47' || weapon === 'deagle' || weapon === 'm249';
    const duration = isHeavy ? 0.16 : 0.1;
    this.noise(duration, isHeavy ? 620 : 980, 0.26 * closeness, 'lowpass');
    this.tone(
      weapon === 'awp' ? 92 : isHeavy ? 135 : 180,
      duration,
      0.11 * closeness,
      'sawtooth',
      weapon === 'awp' ? 42 : 70,
    );
    if (weapon === 'knife') {
      this.noise(0.05, 2200, 0.12, 'bandpass');
    }
  }

  hit(headshot: boolean): void {
    if (headshot) {
      // A short metallic crack makes headshots unmistakable without being harsh.
      this.noise(0.045, 2400, 0.13, 'bandpass');
      this.tone(1760, 0.055, 0.15, 'sine', 2400);
      this.tone(2600, 0.035, 0.055, 'sine', 3000);
      return;
    }
    this.noise(0.025, 1300, 0.045, 'bandpass');
    this.tone(900, 0.05, 0.09, 'sine', 720);
  }

  explosion(distance = 0): void {
    const audio = this.ensure();
    if (audio === null) {
      return;
    }
    const closeness = 1 / (1 + Math.max(0, distance) * 0.025);
    this.noise(0.7, 170, 0.5 * closeness, 'lowpass');
    this.tone(68, 0.65, 0.3 * closeness, 'sawtooth', 28);
    window.setTimeout(() => this.noise(0.35, 340, 0.18 * closeness, 'lowpass'), 70);
  }

  damage(): void {
    const audio = this.ensure();
    if (audio === null) {
      return;
    }
    this.noise(0.18, 260, 0.18, 'lowpass');
    this.tone(120, 0.14, 0.1, 'sine', 72);
  }

  kill(): void {
    this.tone(520, 0.1, 0.1, 'triangle', 780);
    window.setTimeout(() => this.tone(880, 0.12, 0.08, 'triangle', 1180), 70);
  }

  reload(): void {
    const audio = this.ensure();
    if (audio === null) {
      return;
    }
    this.noise(0.035, 1800, 0.13, 'bandpass');
    window.setTimeout(() => this.noise(0.045, 1200, 0.11, 'bandpass'), 110);
  }

  reloadFinish(): void {
    const audio = this.ensure();
    if (audio === null) {
      return;
    }
    this.noise(0.025, 2200, 0.1, 'bandpass');
    this.tone(160, 0.045, 0.055, 'square', 110);
  }

  switchWeapon(): void {
    const audio = this.ensure();
    if (audio === null) {
      return;
    }
    this.noise(0.04, 1600, 0.08, 'bandpass');
    window.setTimeout(() => this.noise(0.025, 2600, 0.06, 'bandpass'), 55);
  }

  whiz(distance = 0, pan = 0): void {
    const audio = this.ensure();
    if (audio === null) {
      return;
    }
    const closeness = Math.max(0.04, 1 - Math.max(0, distance) / 18);
    this.noise(0.07, 2600, 0.13 * closeness, 'bandpass', pan);
    this.tone(1500, 0.075, 0.04 * closeness, 'sine', 2800, pan);
  }

  pickup(): void {
    this.tone(480, 0.08, 0.08, 'square', 720);
    window.setTimeout(() => this.tone(760, 0.09, 0.06, 'square', 980), 70);
  }

  footstep(distance = 0, pan = 0): void {
    const audio = this.ensure();
    if (audio === null) {
      return;
    }
    // Footsteps were effectively inaudible at 0.12 gain. Keep them subtle but
    // present, and pan them so the direction of a nearby player is readable.
    const closeness = 1 / (1 + Math.max(0, distance) * 0.075);
    const frequency = 250 + Math.random() * 90;
    this.noise(0.065, frequency, 0.3 * closeness, 'lowpass', pan);
    this.tone(72 + Math.random() * 12, 0.05, 0.075 * closeness, 'sine', 48, pan);
  }

  setVolumes(masterVolume: number, effectsVolume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, masterVolume));
    this.effectsVolume = Math.max(0, Math.min(1, effectsVolume));
    if (this.master !== null) {
      this.master.gain.value = 0.65 * this.masterVolume;
    }
    if (this.effects !== null) {
      this.effects.gain.value = this.effectsVolume;
    }
  }

  countdown(seconds: number): void {
    this.tone(seconds <= 1 ? 880 : 440, 0.09, 0.1, 'square');
  }

  roundEnd(win: boolean): void {
    if (win) {
      this.tone(523, 0.18, 0.09, 'triangle');
      window.setTimeout(() => this.tone(659, 0.2, 0.09, 'triangle'), 110);
      window.setTimeout(() => this.tone(784, 0.3, 0.1, 'triangle'), 230);
    } else {
      this.tone(220, 0.25, 0.09, 'sawtooth', 140);
      window.setTimeout(() => this.tone(160, 0.35, 0.08, 'sawtooth', 90), 160);
    }
  }

  empty(): void {
    this.noise(0.03, 2400, 0.08, 'highpass');
  }

  bombPlantStart(distance = 0, pan = 0): void {
    if (distance > 28) {
      return;
    }
    const audio = this.ensure();
    if (audio === null) {
      return;
    }
    const closeness = Math.max(0.08, 1 - Math.max(0, distance) / 28);
    this.tone(1320, 0.055, 0.14 * closeness, 'square', 1320, pan);
    window.setTimeout(() => this.tone(1560, 0.055, 0.13 * closeness, 'square', 1560, pan), 90);
    window.setTimeout(() => this.tone(1760, 0.065, 0.14 * closeness, 'square', 1760, pan), 180);
  }

  bombPlanted(distance = 0, pan = 0): void {
    const audio = this.ensure();
    if (audio === null) {
      return;
    }
    const closeness = Math.max(0.18, 1 / (1 + Math.max(0, distance) * 0.04));
    this.tone(980, 0.09, 0.16 * closeness, 'sawtooth', 1240, pan);
    window.setTimeout(() => this.tone(1480, 0.14, 0.18 * closeness, 'sawtooth', 1480, pan), 110);
  }

  bombDefuseStart(distance = 0, pan = 0, hasKit = false): void {
    if (distance > 28) {
      return;
    }
    const audio = this.ensure();
    if (audio === null) {
      return;
    }
    const closeness = Math.max(0.08, 1 - Math.max(0, distance) / 28);
    this.noise(0.06, 2100, 0.16 * closeness, 'bandpass', pan);
    this.tone(hasKit ? 1120 : 840, 0.07, 0.14 * closeness, 'triangle', hasKit ? 1480 : 1040, pan);
    window.setTimeout(
      () => this.noise(0.05, 2600, 0.14 * closeness, 'bandpass', pan),
      hasKit ? 75 : 110,
    );
  }

  bombDefused(): void {
    const audio = this.ensure();
    if (audio === null) {
      return;
    }
    this.tone(587, 0.14, 0.12, 'triangle', 659);
    window.setTimeout(() => this.tone(880, 0.24, 0.13, 'triangle', 1046), 120);
  }

  bombBeep(urgency = 0, distance = 0, pan = 0): void {
    if (distance > 36) {
      return;
    }
    const audio = this.ensure();
    if (audio === null) {
      return;
    }
    const closeness = Math.max(0.08, 1 - Math.max(0, distance) / 36);
    const freq = 1950 + Math.max(0, Math.min(1, urgency)) * 520;
    this.tone(freq, 0.045, 0.13 * closeness, 'sine', freq, pan);
  }

  bombExplosion(distance = 0): void {
    const audio = this.ensure();
    if (audio === null) {
      return;
    }
    const closeness = Math.max(0.25, 1 / (1 + Math.max(0, distance) * 0.02));
    this.noise(1.1, 140, 0.65 * closeness, 'lowpass');
    this.tone(54, 0.95, 0.42 * closeness, 'sawtooth', 22);
    window.setTimeout(() => this.noise(0.65, 290, 0.3 * closeness, 'lowpass'), 85);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.context !== null) {
      void this.context.close().catch(() => undefined);
    }
    this.context = null;
    this.master = null;
    this.effects = null;
    this.noiseBuffer = null;
  }

  private ensure(): AudioContext | null {
    if (this.disposed) {
      return null;
    }
    if (this.context === null) {
      this.resume();
    }
    return this.context;
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * 0.5);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private noise(
    duration: number,
    frequency: number,
    gain: number,
    type: BiquadFilterType,
    pan = 0,
  ): void {
    const context = this.context;
    const effects = this.effects;
    const buffer = this.noiseBuffer;
    if (context === null || effects === null || buffer === null) {
      return;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    const envelope = context.createGain();
    const start = context.currentTime;
    envelope.gain.setValueAtTime(Math.max(0.0001, gain), start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(envelope);
    this.connectOutput(envelope, pan);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  private tone(
    frequency: number,
    duration: number,
    gain: number,
    type: OscillatorType,
    endFrequency = frequency,
    pan = 0,
  ): void {
    const context = this.context;
    const effects = this.effects;
    if (context === null || effects === null) {
      return;
    }

    const oscillator = context.createOscillator();
    oscillator.type = type;
    const start = context.currentTime;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(Math.max(0.0001, gain), start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    this.connectOutput(envelope, pan);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private connectOutput(node: AudioNode, pan: number): void {
    const context = this.context;
    const effects = this.effects;
    if (context === null || effects === null) {
      return;
    }
    const clamped = Math.max(-1, Math.min(1, pan));
    if (Math.abs(clamped) < 0.01) {
      node.connect(effects);
      return;
    }
    const panner = context.createStereoPanner();
    panner.pan.value = clamped;
    node.connect(panner);
    panner.connect(effects);
  }
}
