/*
 * Pure helpers shared by the app: music theory, mixer curves, beat-grid maths,
 * waveform analysis and BPM detection. No DOM / Web Audio here so it can be
 * unit-tested in Node (see test/util.test.js).
 */
(function (root) {
  'use strict';

  const U = {};

  U.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** Small deterministic PRNG so generated tracks sound identical every time. */
  U.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // ---------------------------------------------------------------- music theory
  U.midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  U.SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    major: [0, 2, 4, 5, 7, 9, 11],
  };

  /** MIDI note for a scale degree (degrees may be negative or exceed one octave). */
  U.scaleNote = function (root, scale, degree) {
    const n = scale.length;
    const oct = Math.floor(degree / n);
    const idx = ((degree % n) + n) % n;
    return root + oct * 12 + scale[idx];
  };

  /** Stacked-thirds chord built on a scale degree. */
  U.chordNotes = function (root, scale, degree, size) {
    const out = [];
    for (let i = 0; i < (size || 3); i++) out.push(U.scaleNote(root, scale, degree + i * 2));
    return out;
  };

  // ---------------------------------------------------------------- mixer curves
  /** Crossfader position x in [-1 (deck A), 1 (deck B)] -> channel gains. */
  U.crossfaderGains = function (x, curve) {
    x = U.clamp(x, -1, 1);
    if (curve === 'sharp') {
      // Scratch curve: both channels at full level until the last ~6% of travel.
      return { a: U.clamp((1 - x) * 8, 0, 1), b: U.clamp((1 + x) * 8, 0, 1) };
    }
    const p = ((x + 1) / 4) * Math.PI; // constant power
    return { a: Math.cos(p), b: Math.sin(p) };
  };

  /** EQ knob in [-1, 1] -> dB. Right = up to +6 dB boost, full left = kill. */
  U.eqKnobToDb = function (v) {
    v = U.clamp(v, -1, 1);
    if (v >= 0) return v * 6;
    const amp = Math.pow(1 + v, 2);
    return amp <= 0.001 ? -60 : Math.max(-60, 20 * Math.log10(amp));
  };

  /** Trim knob in [-1, 1] -> linear gain (+/-12 dB). */
  U.trimKnobToGain = (v) => Math.pow(10, (U.clamp(v, -1, 1) * 12) / 20);

  /** Channel fader in [0, 1] -> linear gain. */
  U.faderToGain = (v) => Math.pow(U.clamp(v, 0, 1), 2);

  /**
   * One-knob DJ filter in [-1, 1]. Left sweeps a low-pass down, right sweeps a
   * high-pass up, the middle is bypass.
   */
  U.filterKnobToFreqs = function (f) {
    f = U.clamp(f, -1, 1);
    const dead = 0.02;
    if (Math.abs(f) <= dead) return { lp: 22000, hp: 10 };
    const t = (Math.abs(f) - dead) / (1 - dead);
    if (f < 0) return { lp: 20000 * Math.pow(60 / 20000, t), hp: 10 };
    return { lp: 22000, hp: 20 * Math.pow(8000 / 20, t) };
  };

  // ---------------------------------------------------------------- beat grid
  U.beatLength = (bpm) => 60 / bpm;

  /** Beat index (float) of time t on a grid. */
  U.beatAt = (t, bpm, firstBeat) => (t - firstBeat) / U.beatLength(bpm);

  U.nearestBeat = function (t, bpm, firstBeat) {
    return firstBeat + Math.round(U.beatAt(t, bpm, firstBeat)) * U.beatLength(bpm);
  };

  /** Beat at or just before t (tolerant of floating point noise). */
  U.previousBeat = function (t, bpm, firstBeat) {
    return firstBeat + Math.floor(U.beatAt(t, bpm, firstBeat) + 1e-6) * U.beatLength(bpm);
  };

  /** Position inside the current beat, in [0, 1). */
  U.beatPhase = function (t, bpm, firstBeat) {
    const b = U.beatAt(t, bpm, firstBeat);
    return b - Math.floor(b);
  };

  /** Shortest signed distance (in beats) from phase `from` to phase `to`. */
  U.phaseDelta = function (from, to) {
    let d = to - from;
    d -= Math.round(d);
    return d;
  };

  /**
   * Tempo ratio needed for a track at `ownBpm` to play at `targetBpm`.
   * Allows half/double time (e.g. 87 <-> 174) and picks the closest match.
   */
  U.syncRatio = function (ownBpm, targetBpm) {
    let best = null;
    for (const mult of [1, 2, 0.5]) {
      const ratio = (targetBpm * mult) / ownBpm;
      if (!best || Math.abs(Math.log(ratio)) < Math.abs(Math.log(best.ratio))) best = { ratio, mult };
    }
    return best;
  };

  U.formatTime = function (sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const t = Math.floor((sec * 10) % 10);
    return m + ':' + String(s).padStart(2, '0') + '.' + t;
  };

  // ---------------------------------------------------------------- analysis
  /**
   * Three-band peak envelope for coloured waveforms.
   * Returns Float32Arrays (0..1) with `binsPerSec` bins per second.
   */
  U.analyzePeaks = function (L, R, sampleRate, binsPerSec) {
    binsPerSec = binsPerSec || 150;
    const hop = sampleRate / binsPerSec;
    const bins = Math.ceil(L.length / hop);
    const low = new Float32Array(bins);
    const mid = new Float32Array(bins);
    const high = new Float32Array(bins);
    const aLow = 1 - Math.exp((-2 * Math.PI * 250) / sampleRate);
    const aMid = 1 - Math.exp((-2 * Math.PI * 2500) / sampleRate);
    let lp1 = 0, lp2 = 0;
    let max = 1e-9;
    for (let b = 0; b < bins; b++) {
      const start = Math.floor(b * hop);
      const end = Math.min(L.length, Math.floor((b + 1) * hop));
      let pl = 0, pm = 0, ph = 0;
      for (let i = start; i < end; i++) {
        const x = R ? (L[i] + R[i]) * 0.5 : L[i];
        lp1 += aLow * (x - lp1);
        lp2 += aMid * (x - lp2);
        const l = Math.abs(lp1), m = Math.abs(lp2 - lp1), h = Math.abs(x - lp2);
        if (l > pl) pl = l;
        if (m > pm) pm = m;
        if (h > ph) ph = h;
      }
      low[b] = pl; mid[b] = pm; high[b] = ph;
      const tot = Math.max(pl, pm, ph);
      if (tot > max) max = tot;
    }
    for (let b = 0; b < bins; b++) {
      low[b] /= max; mid[b] /= max; high[b] /= max;
    }
    return { binsPerSec, bins, low, mid, high };
  };

  /**
   * Estimate tempo and first downbeat-ish beat of a mono signal.
   * Onset envelope -> autocorrelation for a coarse tempo -> comb-filter search
   * for a fine tempo and the beat phase.
   */
  U.detectBpm = function (L, sampleRate, opts) {
    opts = opts || {};
    const minBpm = opts.minBpm || 70;
    const maxBpm = opts.maxBpm || 180;
    const frameRate = 400;
    const hop = Math.max(1, Math.round(sampleRate / frameRate));
    const fr = sampleRate / hop;

    // Analyse up to 90 s from the middle-ish of the track.
    const maxLen = Math.min(L.length, Math.floor(90 * sampleRate));
    const offset = Math.max(0, Math.floor((L.length - maxLen) / 3));
    const frames = Math.floor(maxLen / hop);
    if (frames < fr * 4) return null;

    const env = new Float32Array(frames);
    const a = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate);
    let lp = 0, prevX = 0;
    for (let f = 0; f < frames; f++) {
      let eLow = 0, eHigh = 0;
      const base = offset + f * hop;
      for (let i = 0; i < hop; i++) {
        const x = L[base + i];
        lp += a * (x - lp);
        eLow += lp * lp;
        const d = x - prevX;
        eHigh += d * d;
        prevX = x;
      }
      env[f] = Math.log(1 + 1000 * eLow) + 0.5 * Math.log(1 + 1000 * eHigh);
    }
    const onset = new Float32Array(frames);
    for (let f = 1; f < frames; f++) onset[f] = Math.max(0, env[f] - env[f - 1]);
    // remove slow trend
    let mean = 0;
    for (let f = 0; f < frames; f++) mean += onset[f];
    mean /= frames;
    for (let f = 0; f < frames; f++) onset[f] = Math.max(0, onset[f] - mean);

    // Coarse tempo via autocorrelation, weighted towards ~120 BPM.
    const minLag = Math.floor((60 / maxBpm) * fr);
    const maxLag = Math.ceil((60 / minBpm) * fr);
    let bestLag = minLag, bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag];
      const bpm = (60 * fr) / lag;
      const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
      s *= w;
      if (s > bestScore) { bestScore = s; bestLag = lag; }
    }
    const coarse = (60 * fr) / bestLag;

    // Fine search: comb filter over tempo and phase.
    const comb = function (bpm) {
      const period = (60 / bpm) * fr;
      const phases = Math.ceil(period);
      let best = -Infinity, bestPhase = 0;
      for (let p = 0; p < phases; p++) {
        let s = 0;
        for (let t = p; t < frames - 1; t += period) {
          const i = Math.round(t);
          s += onset[i] + 0.5 * (onset[i - 1] || 0) + 0.5 * onset[i + 1];
        }
        if (s > best) { best = s; bestPhase = p; }
      }
      return { score: best / (frames / period), phase: bestPhase };
    };
    let best = { bpm: coarse, score: -Infinity, phase: 0 };
    for (let bpm = coarse - 2; bpm <= coarse + 2; bpm += 0.02) {
      const c = comb(bpm);
      if (c.score > best.score) best = { bpm, score: c.score, phase: c.phase };
    }
    const bpm = Math.round(best.bpm * 100) / 100;
    const period = 60 / bpm;
    const phaseSec = (offset / sampleRate + best.phase / fr) % period;
    return { bpm, firstBeat: phaseSec };
  };

  /** Camelot wheel code for a key name like "A minor". */
  U.CAMELOT = {
    'G# minor': '1A', 'B major': '1B', 'D# minor': '2A', 'F# major': '2B',
    'Bb minor': '3A', 'Db major': '3B', 'F minor': '4A', 'Ab major': '4B',
    'C minor': '5A', 'Eb major': '5B', 'G minor': '6A', 'Bb major': '6B',
    'D minor': '7A', 'F major': '7B', 'A minor': '8A', 'C major': '8B',
    'E minor': '9A', 'G major': '9B', 'B minor': '10A', 'D major': '10B',
    'F# minor': '11A', 'A major': '11B', 'C# minor': '12A', 'E major': '12B',
  };

  /** Two Camelot keys mix harmonically if equal, adjacent numbers, or relative major/minor. */
  U.keysCompatible = function (a, b) {
    if (!a || !b) return false;
    const pa = /^(\d+)([AB])$/.exec(a), pb = /^(\d+)([AB])$/.exec(b);
    if (!pa || !pb) return false;
    const na = +pa[1], nb = +pb[1];
    if (pa[2] === pb[2]) {
      const d = Math.abs(na - nb);
      return d === 0 || d === 1 || d === 11;
    }
    return na === nb;
  };

  root.DJ = root.DJ || {};
  root.DJ.util = U;
  if (typeof module !== 'undefined' && module.exports) module.exports = U;
})(typeof window !== 'undefined' ? window : globalThis);
