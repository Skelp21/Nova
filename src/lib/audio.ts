import Hls from "hls.js";
import type { StreamInfo } from "./types";

export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS: Record<string, number[]> = {
  "Ровно": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Бас": [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  "Супер-бас": [9, 8, 6, 3, 0, -1, -1, 0, 0, 0],
  "Вокал": [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  "Рок": [5, 3, 1, -1, -2, -1, 1, 3, 4, 5],
  "Электроника": [5, 4, 1, 0, -2, 1, 0, 2, 4, 5],
  "Поп": [-1, 1, 3, 4, 3, 0, -1, -1, 0, 1],
  "Джаз": [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  "Классика": [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  "Ночь (тихо)": [3, 2, 1, 0, -1, -2, -2, -3, -4, -5],
};

export interface EqState {
  enabled: boolean;
  preamp: number; // dB
  bands: number[]; // dB
}

/**
 * The single audio element of the app, routed through Web Audio:
 * element -> preamp -> 10 biquad bands -> output.
 * The graph is built lazily on first play (needs a user gesture).
 */
class AudioEngine {
  readonly el: HTMLAudioElement;
  private hls: Hls | null = null;
  private ctx: AudioContext | null = null;
  private preamp: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private eq: EqState = { enabled: false, preamp: 0, bands: EQ_FREQS.map(() => 0) };

  constructor() {
    this.el = new Audio();
    this.el.crossOrigin = "anonymous";
    this.el.preload = "auto";
  }

  private ensureGraph() {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: "playback" });
    const src = ctx.createMediaElementSource(this.el);
    const pre = ctx.createGain();
    const filters = EQ_FREQS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? "lowshelf" : i === EQ_FREQS.length - 1 ? "highshelf" : "peaking";
      b.frequency.value = f;
      b.Q.value = 1.1;
      return b;
    });
    src.connect(pre);
    let node: AudioNode = pre;
    for (const f of filters) {
      node.connect(f);
      node = f;
    }
    node.connect(ctx.destination);
    this.ctx = ctx;
    this.preamp = pre;
    this.filters = filters;
    this.applyEq();
  }

  private applyEq() {
    if (!this.ctx || !this.preamp) return;
    const t = this.ctx.currentTime;
    const on = this.eq.enabled;
    this.preamp.gain.setTargetAtTime(on ? Math.pow(10, this.eq.preamp / 20) : 1, t, 0.02);
    this.filters.forEach((f, i) => f.gain.setTargetAtTime(on ? this.eq.bands[i] ?? 0 : 0, t, 0.02));
  }

  setEq(eq: EqState) {
    this.eq = eq;
    this.applyEq();
  }

  load(stream: StreamInfo) {
    this.hls?.destroy();
    this.hls = null;
    if (stream.kind === "hls" && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) this.el.dispatchEvent(new Event("error"));
      });
      hls.loadSource(stream.url);
      hls.attachMedia(this.el);
      this.hls = hls;
    } else {
      this.el.src = stream.url;
      this.el.load();
    }
  }

  async play() {
    this.ensureGraph();
    if (this.ctx?.state === "suspended") await this.ctx.resume();
    await this.el.play();
  }

  pause() {
    this.el.pause();
  }

  stop() {
    this.hls?.destroy();
    this.hls = null;
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
  }

  seek(t: number) {
    if (isFinite(t)) this.el.currentTime = Math.max(0, t);
  }

  setVolume(v: number, muted: boolean) {
    // Perceptual curve: slider 50% ≈ -12 dB.
    this.el.volume = muted ? 0 : Math.min(1, Math.max(0, v * v));
  }

  setRate(r: number) {
    this.el.playbackRate = r;
    this.el.preservesPitch = true;
  }
}

export const engine = new AudioEngine();
