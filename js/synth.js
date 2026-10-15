/*
 * Procedural track generator.
 *
 * Every track in the library is composed and synthesised in the browser from
 * the recipes below (seeded RNG, so a track sounds identical every time).
 * Nothing is sampled from existing recordings, so the music is 100% original
 * and free of copyright claims.
 *
 * How a track is built:
 *   1. Each part (kick, hats, bass, chords, lead, ...) is rendered once as a
 *      short loop ("stem") with an OfflineAudioContext.
 *   2. Stems are levelled to a target loudness so the mix is balanced.
 *   3. The loops are laid out according to a DJ-friendly arrangement
 *      (beat-only intro/outro, breakdown, drop) with kick side-chain ducking.
 */
(function (root) {
  'use strict';

  const U = root.DJ.util;
  const SR = 44100;

  // ------------------------------------------------------------------ catalogue
  const ARRANGEMENTS = {
    club: [
      { name: 'Intro', bars: 16, on: ['kick', 'hats', 'perc'] },
      { name: 'Build', bars: 8, on: ['kick', 'hats', 'hatsOpen', 'perc', 'clap', 'bass'], fill: true },
      { name: 'Groove', bars: 16, on: ['kick', 'hats', 'hatsOpen', 'perc', 'clap', 'bass', 'chords'], crash: true, fill: true },
      { name: 'Breakdown', bars: 16, on: ['pad', 'chords', 'lead'], riser: true },
      { name: 'Drop', bars: 24, on: ['kick', 'hats', 'hatsOpen', 'perc', 'clap', 'bass', 'chords', 'lead'], crash: true, fill: true },
      { name: 'Outro', bars: 16, on: ['kick', 'hats', 'perc', 'clap'] },
    ],
    dnb: [
      { name: 'Intro', bars: 16, on: ['hats', 'perc', 'pad'] },
      { name: 'Build', bars: 16, on: ['kick', 'clap', 'hats', 'perc', 'pad'], riser: true },
      { name: 'Drop', bars: 32, on: ['kick', 'clap', 'hats', 'hatsOpen', 'perc', 'bass', 'lead'], crash: true, fill: true },
      { name: 'Breakdown', bars: 16, on: ['pad', 'lead', 'hats'], riser: true },
      { name: 'Drop 2', bars: 32, on: ['kick', 'clap', 'hats', 'hatsOpen', 'perc', 'bass', 'lead', 'chords'], crash: true, fill: true },
      { name: 'Outro', bars: 16, on: ['kick', 'clap', 'hats', 'perc'] },
    ],
    lofi: [
      { name: 'Intro', bars: 8, on: ['chords', 'crackle'] },
      { name: 'Verse', bars: 16, on: ['kick', 'clap', 'hats', 'bass', 'chords', 'crackle'], fill: true },
      { name: 'Hook', bars: 16, on: ['kick', 'clap', 'hats', 'perc', 'bass', 'chords', 'lead', 'crackle'], fill: true },
      { name: 'Verse 2', bars: 16, on: ['kick', 'clap', 'hats', 'bass', 'chords', 'lead', 'crackle'] },
      { name: 'Outro', bars: 8, on: ['kick', 'hats', 'chords', 'crackle'] },
    ],
  };

  /*
   * Pattern strings are one bar of 16th notes.
   *   Drums:  X accent, x normal, o soft, . ghost, - rest
   *   Bass:   x root, o octave up, 5 fifth, 3 third, = hold previous, - rest
   *   Chords: x hit, = hold, - rest
   */
  const TRACKS = [
    {
      id: 'neon-arcade', title: 'Neon Arcade', genre: 'House', bpm: 124, key: 'A minor',
      scale: 'minor', chordRoot: 57, bassRoot: 33, leadRoot: 69, seed: 11,
      progression: [0, 5, 2, 6], arrangement: 'club', swing: 0.06, duck: 0.55,
      kick: { pattern: 'X---X---X---X---', start: 155, end: 50, sweep: 0.07, decay: 0.32, click: 0.35 },
      clap: { type: 'clap', pattern: '----x-------x---' },
      hats: { pattern: 'x.o.x.o.x.o.x.o.', decay: 0.035 },
      hatsOpen: { pattern: '--x---x---x---x-', decay: 0.18 },
      perc: { type: 'shaker', pattern: '.o.o.o.o.o.o.o.o' },
      bass: { pattern: '--x=--x=--x=--o=', voice: 'pluckBass' },
      chords: { pattern: '---x=-x=---x=-x-', voice: 'stab', size: 3 },
      pad: { voice: 'pad', size: 4 },
      lead: { style: 'pluck', density: 0.55 },
    },
    {
      id: 'midnight-circuit', title: 'Midnight Circuit', genre: 'Techno', bpm: 128, key: 'F minor',
      scale: 'minor', chordRoot: 53, bassRoot: 29, leadRoot: 65, seed: 23,
      progression: [0, 0, 5, 3], arrangement: 'club', swing: 0, duck: 0.6,
      kick: { pattern: 'X---X---X---X---', start: 140, end: 44, sweep: 0.09, decay: 0.45, click: 0.25, drive: 2.5 },
      clap: { type: 'clap', pattern: '----o-------o---' },
      hats: { pattern: 'xoxoxoxoxoxoxoxo', decay: 0.03 },
      hatsOpen: { pattern: '--x---x---x---x-', decay: 0.14 },
      perc: { type: 'rim', pattern: '---x--x----x-x--' },
      bass: { pattern: '-xxx-xxo-xxx-xox', voice: 'rollingBass' },
      chords: { pattern: '--------------x-', voice: 'darkStab', size: 3 },
      pad: { voice: 'darkPad', size: 3 },
      lead: { style: 'pluck', density: 0.3, dark: true },
    },
    {
      id: 'solar-drift', title: 'Solar Drift', genre: 'Deep House', bpm: 120, key: 'D minor',
      scale: 'dorian', chordRoot: 50, bassRoot: 38, leadRoot: 74, seed: 37,
      progression: [0, 3, 6, 2], arrangement: 'club', swing: 0.12, duck: 0.4,
      kick: { pattern: 'X---X---X---X---', start: 130, end: 48, sweep: 0.08, decay: 0.38, click: 0.15 },
      clap: { type: 'clap', pattern: '----x-------x--o' },
      hats: { pattern: '--x---x---x---x-', decay: 0.06 },
      hatsOpen: { pattern: '-------------x--', decay: 0.2 },
      perc: { type: 'rim', pattern: '---x-----x--x---' },
      bass: { pattern: 'x==--x=---5=-x=-', voice: 'subBass' },
      chords: { pattern: 'x==----x==------', voice: 'keys', size: 4 },
      pad: { voice: 'pad', size: 4 },
      lead: { style: 'keys', density: 0.35 },
    },
    {
      id: 'acid-rain', title: 'Acid Rain', genre: 'Acid Techno', bpm: 132, key: 'E minor',
      scale: 'minor', chordRoot: 52, bassRoot: 28, leadRoot: 40, seed: 41,
      progression: [0, 0, 0, 0], arrangement: 'club', swing: 0, duck: 0.5,
      kick: { pattern: 'X---X---X---X---', start: 150, end: 46, sweep: 0.08, decay: 0.42, click: 0.3, drive: 2 },
      clap: { type: 'clap', pattern: '----x-------x---' },
      hats: { pattern: 'xxoxxxoxxxoxxxox', decay: 0.025 },
      hatsOpen: { pattern: '--x---x---x---x-', decay: 0.12 },
      perc: { type: 'rim', pattern: 'x--x--x--x--x-x-' },
      bass: { pattern: '--x---x---x---x-', voice: 'subBass' },
      chords: null,
      pad: { voice: 'darkPad', size: 3 },
      lead: { style: 'acid' },
      // the acid line is the main hook, so let it run through more of the track
      sections: { Groove: ['lead'] },
    },
    {
      id: 'glass-horizon', title: 'Glass Horizon', genre: 'Trance', bpm: 138, key: 'B minor',
      scale: 'minor', chordRoot: 59, bassRoot: 35, leadRoot: 71, seed: 53,
      progression: [0, 5, 3, 6], arrangement: 'club', swing: 0, duck: 0.6,
      kick: { pattern: 'X---X---X---X---', start: 160, end: 50, sweep: 0.06, decay: 0.3, click: 0.4 },
      clap: { type: 'clap', pattern: '----x-------x---' },
      hats: { pattern: '-.x.-.x.-.x.-.x.', decay: 0.04 },
      hatsOpen: { pattern: '--x---x---x---x-', decay: 0.15 },
      perc: { type: 'shaker', pattern: 'o.o.o.o.o.o.o.o.' },
      bass: { pattern: '-xxx-xxx-xxx-xxx', voice: 'rollingBass' },
      chords: { pattern: 'x===============', voice: 'supersawPad', size: 3 },
      pad: { voice: 'supersawPad', size: 4 },
      lead: { style: 'arp' },
    },
    {
      id: 'velocity', title: 'Velocity', genre: 'Drum & Bass', bpm: 174, key: 'G minor',
      scale: 'minor', chordRoot: 55, bassRoot: 43, leadRoot: 67, seed: 67,
      progression: [0, 5, 3, 4], arrangement: 'dnb', swing: 0, duck: 0.35,
      kick: { pattern: 'X---------x-----', start: 170, end: 52, sweep: 0.05, decay: 0.28, click: 0.4 },
      clap: { type: 'snare', pattern: '----X-------X---' },
      hats: { pattern: 'x-o-x-o-x-o-x-oo', decay: 0.03 },
      hatsOpen: { pattern: '------x-------x-', decay: 0.12 },
      perc: { type: 'shaker', pattern: '.o.o.o.o.o.o.o.o' },
      bass: { pattern: 'x=========5=====', voice: 'reese' },
      chords: { pattern: 'x=======--------', voice: 'pad', size: 3 },
      pad: { voice: 'pad', size: 4 },
      lead: { style: 'pluck', density: 0.3 },
    },
    {
      id: 'low-tide', title: 'Low Tide', genre: 'Lo-fi Hip Hop', bpm: 88, key: 'Eb major',
      scale: 'major', chordRoot: 51, bassRoot: 39, leadRoot: 75, seed: 79,
      progression: [1, 4, 0, 5], arrangement: 'lofi', swing: 0.22, duck: 0.15,
      kick: { pattern: 'X------x--x-----', start: 110, end: 48, sweep: 0.06, decay: 0.3, click: 0.05 },
      clap: { type: 'snare', pattern: '----x-------x---', soft: true },
      hats: { pattern: 'x-xox-x-x-xox-x-', decay: 0.03 },
      hatsOpen: null,
      perc: { type: 'rim', pattern: '-------x-------x' },
      bass: { pattern: 'x=====-5==-x====', voice: 'subBass' },
      chords: { pattern: 'x=======--x=====', voice: 'keys', size: 4 },
      pad: null,
      lead: { style: 'keys', density: 0.3 },
      crackle: true,
    },
    {
      id: 'afterglow', title: 'Afterglow', genre: 'Nu-Disco', bpm: 118, key: 'A minor',
      scale: 'minor', chordRoot: 57, bassRoot: 33, leadRoot: 69, seed: 83,
      progression: [0, 3, 6, 5], arrangement: 'club', swing: 0.08, duck: 0.45,
      kick: { pattern: 'X---X---X---X---', start: 140, end: 52, sweep: 0.06, decay: 0.3, click: 0.3 },
      clap: { type: 'clap', pattern: '----x-------x---' },
      hats: { pattern: 'xoxoxoxoxoxoxoxo', decay: 0.04 },
      hatsOpen: { pattern: '--x---x---x---x-', decay: 0.2 },
      perc: { type: 'shaker', pattern: '..x...x...x...x.' },
      bass: { pattern: 'x-o-x-o-x-o-x-o5', voice: 'discoBass' },
      chords: { pattern: '--x=--x=--x=-x=-', voice: 'stab', size: 3 },
      pad: { voice: 'pad', size: 4 },
      lead: { style: 'pluck', density: 0.6 },
    },
    {
      id: 'pulse-theory', title: 'Pulse Theory', genre: 'Tech House', bpm: 126, key: 'E minor',
      scale: 'minor', chordRoot: 52, bassRoot: 28, leadRoot: 64, seed: 97,
      progression: [0, 0, 3, 0], arrangement: 'club', swing: 0.1, duck: 0.5,
      kick: { pattern: 'X---X---X---X---', start: 145, end: 47, sweep: 0.08, decay: 0.4, click: 0.25, drive: 1.5 },
      clap: { type: 'clap', pattern: '----x-------x---' },
      hats: { pattern: '.-x-.-x-.-x-.-xo', decay: 0.04 },
      hatsOpen: { pattern: '--x---x---x---x-', decay: 0.1 },
      perc: { type: 'rim', pattern: '-x--x--x---x--x-' },
      bass: { pattern: '--x-x=-x--x-x=-o', voice: 'pluckBass' },
      chords: { pattern: '------x-------x-', voice: 'darkStab', size: 3 },
      pad: { voice: 'darkPad', size: 3 },
      lead: { style: 'pluck', density: 0.35 },
    },
  ];

  // Target loudness per stem (dBFS RMS for loops, dBFS peak for one-shots).
  const LEVELS = {
    kick: -11, clap: -21, hats: -27, hatsOpen: -29, perc: -29, bass: -15,
    chords: -21, pad: -24, lead: -20, crackle: -36,
  };
  const PEAK_LEVELS = { fill: -12, riser: -10, crash: -12 };
  const DUCKED = { bass: 1, chords: 1, pad: 1, lead: 0.6 };

  const barsOf = (arr) => arr.reduce((n, s) => n + s.bars, 0);

  for (const t of TRACKS) {
    t.camelot = U.CAMELOT[t.key];
    t.artist = 'DJ Practice Lab (original)';
    t.bars = barsOf(ARRANGEMENTS[t.arrangement]);
    t.duration = (t.bars * 240) / t.bpm;
    t.generated = true;
  }

  // ------------------------------------------------------------------ helpers
  function makeKit(ctx, seed) {
    const rnd = U.mulberry32(seed);
    const noise = ctx.createBuffer(1, SR * 2, SR);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;

    const kit = { rnd };
    kit.noise = function (t, dur) {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.start(t, rnd() * 1.5);
      s.stop(t + dur);
      return s;
    };
    kit.reverb = function (seconds) {
      const len = Math.floor(seconds * SR);
      const ir = ctx.createBuffer(2, len, SR);
      for (let c = 0; c < 2; c++) {
        const ch = ir.getChannelData(c);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          lp += 0.35 * (rnd() * 2 - 1 - lp);
          ch[i] = lp * Math.exp((-6.9 * i) / len);
        }
      }
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      return conv;
    };
    kit.shaper = function (amount) {
      const ws = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
      }
      ws.curve = curve;
      ws.oversample = '2x';
      return ws;
    };
    return kit;
  }

  /** Dry path plus optional reverb / tempo-synced delay sends. */
  function fxBus(ctx, kit, dest, o) {
    const input = ctx.createGain();
    input.connect(dest);
    if (o.delay) {
      const send = ctx.createGain();
      send.gain.value = o.delay.mix;
      const d = ctx.createDelay(4);
      d.delayTime.value = o.delay.time;
      const fb = ctx.createGain();
      fb.gain.value = o.delay.feedback;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2800;
      const pan = ctx.createStereoPanner();
      pan.pan.value = 0.35;
      input.connect(send);
      send.connect(d);
      d.connect(lp);
      lp.connect(fb);
      fb.connect(d);
      lp.connect(pan);
      pan.connect(dest);
    }
    if (o.reverb) {
      const send = ctx.createGain();
      send.gain.value = o.reverb.mix;
      const conv = kit.reverb(o.reverb.size);
      input.connect(send);
      send.connect(conv);
      conv.connect(dest);
    }
    return input;
  }

  function envelope(param, t, dur, vel, a, d, s, r) {
    a = Math.min(a, dur * 0.5);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(vel, t + a);
    param.setTargetAtTime(vel * s, t + a, Math.max(0.001, d / 3));
    param.setTargetAtTime(0, t + dur, Math.max(0.002, r / 4));
  }

  // ------------------------------------------------------------------ drums
  const DRUMS = {
    kick(ctx, kit, dest, t, vel, o) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(o.start, t);
      osc.frequency.exponentialRampToValueAtTime(o.end, t + o.sweep);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.03, o.decay / 4);
      osc.connect(g);
      g.connect(dest);
      osc.start(t);
      osc.stop(t + o.decay + 0.1);
      if (o.click) {
        const n = kit.noise(t, 0.03);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1800;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(o.click * vel, t);
        ng.gain.setTargetAtTime(0, t, 0.004);
        n.connect(hp);
        hp.connect(ng);
        ng.connect(dest);
      }
    },
    clap(ctx, kit, dest, t, vel) {
      const n = kit.noise(t, 0.4);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200;
      bp.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.011;
        g.gain.setValueAtTime(vel, tt);
        g.gain.setTargetAtTime(vel * 0.15, tt + 0.0005, 0.003);
      }
      g.gain.setValueAtTime(vel * 0.9, t + 0.034);
      g.gain.setTargetAtTime(0, t + 0.035, 0.05);
      n.connect(bp);
      bp.connect(g);
      g.connect(dest);
    },
    snare(ctx, kit, dest, t, vel, o) {
      const soft = o && o.soft;
      const n = kit.noise(t, 0.35);
      const hp = ctx.createBiquadFilter();
      hp.type = soft ? 'bandpass' : 'highpass';
      hp.frequency.value = soft ? 2500 : 1400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel, t);
      g.gain.setTargetAtTime(0, t + 0.005, soft ? 0.05 : 0.045);
      n.connect(hp);
      hp.connect(g);
      g.connect(dest);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(170, t + 0.06);
      const og = ctx.createGain();
      og.gain.setValueAtTime(vel * 0.8, t);
      og.gain.setTargetAtTime(0, t + 0.003, 0.025);
      osc.connect(og);
      og.connect(dest);
      osc.start(t);
      osc.stop(t + 0.25);
    },
    hats(ctx, kit, dest, t, vel, o) {
      const n = kit.noise(t, o.decay * 5 + 0.05);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel, t);
      g.gain.setTargetAtTime(0, t + 0.002, o.decay / 3);
      n.connect(hp);
      hp.connect(g);
      g.connect(dest);
    },
    shaker(ctx, kit, dest, t, vel) {
      const n = kit.noise(t, 0.12);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 6500;
      bp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel, t + 0.012);
      g.gain.setTargetAtTime(0, t + 0.014, 0.018);
      n.connect(bp);
      bp.connect(g);
      g.connect(dest);
    },
    rim(ctx, kit, dest, t, vel) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 1750;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      bp.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel, t);
      g.gain.setTargetAtTime(0, t + 0.001, 0.012);
      osc.connect(bp);
      bp.connect(g);
      g.connect(dest);
      osc.start(t);
      osc.stop(t + 0.1);
    },
    crash(ctx, kit, dest, t, vel) {
      const n = kit.noise(t, 3);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 4500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel, t);
      g.gain.setTargetAtTime(0, t + 0.01, 0.55);
      n.connect(hp);
      hp.connect(g);
      g.connect(dest);
    },
  };

  const VEL = { X: 1, x: 0.78, o: 0.5, '.': 0.28 };

  function stepTime(step, bpm, swing) {
    const sd = 15 / bpm;
    return step * sd + (step % 2 === 1 ? swing * sd : 0);
  }

  // ------------------------------------------------------------------ tonal voices
  function voice(ctx, dest, t, dur, midi, vel, o) {
    const freq = U.midiToFreq(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = o.q || 0.7;
    const cutoff = Math.min(18000, o.cutoff);
    if (o.envAmt) {
      f.frequency.setValueAtTime(Math.min(18000, cutoff + o.envAmt * vel), t);
      f.frequency.setTargetAtTime(cutoff, t + 0.001, o.fDecay / 3);
    } else {
      f.frequency.value = cutoff;
    }
    const g = ctx.createGain();
    envelope(g.gain, t, dur, vel, o.a, o.d, o.s, o.r);
    const end = t + dur + o.r + 0.05;
    for (const w of o.waves) {
      const osc = ctx.createOscillator();
      osc.type = w.type;
      osc.frequency.value = freq * Math.pow(2, w.oct || 0);
      osc.detune.value = w.detune || 0;
      const og = ctx.createGain();
      og.gain.value = w.gain == null ? 1 : w.gain;
      osc.connect(og);
      if (w.pan) {
        const p = ctx.createStereoPanner();
        p.pan.value = w.pan;
        og.connect(p);
        p.connect(f);
      } else {
        og.connect(f);
      }
      osc.start(t);
      osc.stop(end);
    }
    if (o.drive) {
      const ws = o.kit.shaper(o.drive);
      f.connect(ws);
      ws.connect(g);
    } else {
      f.connect(g);
    }
    g.connect(dest);
  }

  /** Two-operator FM electric piano. */
  function epiano(ctx, dest, t, dur, midi, vel) {
    const freq = U.midiToFreq(midi);
    const car = ctx.createOscillator();
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(freq * 1.6 * vel, t);
    mg.gain.setTargetAtTime(freq * 0.25, t, 0.25);
    mod.connect(mg);
    mg.connect(car.frequency);
    const tine = ctx.createOscillator();
    tine.frequency.value = freq * 4;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.12 * vel, t);
    tg.gain.setTargetAtTime(0, t, 0.03);
    tine.connect(tg);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.setTargetAtTime(vel * 0.3, t + 0.004, 0.4);
    g.gain.setTargetAtTime(0, t + dur, 0.08);
    car.connect(g);
    tg.connect(dest);
    g.connect(dest);
    const end = t + dur + 0.5;
    for (const o of [car, mod, tine]) {
      o.start(t);
      o.stop(end);
    }
  }

  const SAW3 = [
    { type: 'sawtooth', detune: -9, pan: -0.5 },
    { type: 'sawtooth', detune: 9, pan: 0.5 },
  ];
  const SUPERSAW = [
    { type: 'sawtooth', detune: -22, pan: -0.8, gain: 0.7 },
    { type: 'sawtooth', detune: -9, pan: -0.3 },
    { type: 'sawtooth', detune: 0 },
    { type: 'sawtooth', detune: 9, pan: 0.3 },
    { type: 'sawtooth', detune: 22, pan: 0.8, gain: 0.7 },
  ];

  const VOICES = {
    pluckBass: { waves: [{ type: 'sawtooth' }, { type: 'square', oct: -1, gain: 0.6 }], cutoff: 260, envAmt: 1400, fDecay: 0.12, q: 4, a: 0.003, d: 0.2, s: 0.5, r: 0.04 },
    rollingBass: { waves: [{ type: 'sawtooth' }, { type: 'sine', oct: -1, gain: 0.8 }], cutoff: 220, envAmt: 900, fDecay: 0.06, q: 3, a: 0.002, d: 0.1, s: 0.6, r: 0.03 },
    subBass: { waves: [{ type: 'sine', gain: 1.2 }, { type: 'triangle', oct: 1, gain: 0.25 }], cutoff: 900, a: 0.005, d: 0.3, s: 0.85, r: 0.06 },
    discoBass: { waves: [{ type: 'sawtooth' }, { type: 'square', gain: 0.4 }], cutoff: 400, envAmt: 1800, fDecay: 0.09, q: 5, a: 0.002, d: 0.12, s: 0.4, r: 0.04 },
    reese: { waves: [{ type: 'sawtooth', detune: -16, pan: -0.4 }, { type: 'sawtooth', detune: 16, pan: 0.4 }, { type: 'sine', oct: -1, gain: 1.4 }], cutoff: 420, envAmt: 300, fDecay: 0.6, q: 2, a: 0.01, d: 0.4, s: 0.85, r: 0.08, drive: 2 },
    stab: { waves: SAW3, cutoff: 900, envAmt: 3500, fDecay: 0.12, q: 2, a: 0.003, d: 0.18, s: 0.35, r: 0.08 },
    darkStab: { waves: [{ type: 'square', detune: -7, pan: -0.4 }, { type: 'sawtooth', detune: 7, pan: 0.4 }], cutoff: 500, envAmt: 2200, fDecay: 0.1, q: 6, a: 0.002, d: 0.15, s: 0.2, r: 0.1 },
    pad: { waves: SAW3.concat([{ type: 'triangle', oct: 1, gain: 0.4 }]), cutoff: 1400, q: 0.6, a: 0.6, d: 1, s: 0.9, r: 0.9 },
    darkPad: { waves: [{ type: 'sawtooth', detune: -12, pan: -0.6 }, { type: 'sawtooth', detune: 12, pan: 0.6 }], cutoff: 650, q: 1.5, a: 0.9, d: 1, s: 0.9, r: 1.2 },
    supersawPad: { waves: SUPERSAW, cutoff: 3200, q: 0.8, a: 0.15, d: 0.8, s: 0.8, r: 0.6 },
    pluckLead: { waves: [{ type: 'sawtooth', detune: -6 }, { type: 'square', detune: 6, gain: 0.6 }], cutoff: 700, envAmt: 5000, fDecay: 0.18, q: 2, a: 0.002, d: 0.25, s: 0.15, r: 0.15 },
    darkLead: { waves: [{ type: 'square', detune: -5 }, { type: 'sawtooth', detune: 5 }], cutoff: 400, envAmt: 2500, fDecay: 0.12, q: 5, a: 0.002, d: 0.2, s: 0.1, r: 0.1 },
    arpLead: { waves: [{ type: 'sawtooth', detune: -14, pan: -0.6 }, { type: 'sawtooth' }, { type: 'sawtooth', detune: 14, pan: 0.6 }], cutoff: 1200, envAmt: 6000, fDecay: 0.12, q: 1.5, a: 0.002, d: 0.15, s: 0.2, r: 0.1 },
    acid: { waves: [{ type: 'sawtooth' }], cutoff: 300, envAmt: 2500, fDecay: 0.14, q: 14, a: 0.002, d: 0.15, s: 0.4, r: 0.03, drive: 3 },
  };

  // ------------------------------------------------------------------ pattern parsing
  /** Note events from a bass/chord pattern string: {step, len, ch}. */
  function parseNotes(pattern) {
    const out = [];
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '-' || c === '=') continue;
      let len = 1;
      while (pattern[i + len] === '=') len++;
      out.push({ step: i, len, ch: c });
    }
    return out;
  }

  const BASS_INTERVAL = { x: 0, o: 12, 5: 7, 3: 3 };

  // ------------------------------------------------------------------ melodies
  function makeMotif(rnd, steps, density, lens) {
    const notes = [];
    let deg = [0, 2, 4][Math.floor(rnd() * 3)];
    let s = 0;
    while (s < steps) {
      const p = s % 4 === 0 ? density + 0.25 : s % 2 === 0 ? density : density * 0.35;
      if (rnd() < p) {
        let len = lens[Math.floor(rnd() * lens.length)];
        len = Math.min(len, steps - s);
        const strong = s % 4 === 0;
        let best = deg, bestScore = Infinity;
        for (let cand = -3; cand <= 9; cand++) {
          const m = ((cand % 7) + 7) % 7;
          if (strong && m !== 0 && m !== 2 && m !== 4) continue;
          const score = Math.abs(cand - deg) + rnd() * 2.5 + (cand === deg ? 1.5 : 0);
          if (score < bestScore) { bestScore = score; best = cand; }
        }
        deg = best;
        notes.push({ step: s, len, deg });
        s += len;
      } else {
        s += 1;
      }
    }
    return notes;
  }

  // ------------------------------------------------------------------ stems
  const STEM_TAIL = 1.5;

  async function renderStem(seconds, seed, build) {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    const kit = makeKit(ctx, seed);
    build(ctx, kit, out);
    const buf = await ctx.startRendering();
    return { L: buf.getChannelData(0), R: buf.getChannelData(1) };
  }

  function drumStem(track, name, def, bars) {
    const bpm = track.bpm;
    const barSec = 240 / bpm;
    const type = name === 'clap' ? def.type : name === 'perc' ? def.type : name === 'hatsOpen' ? 'hats' : name;
    const pattern = def.pattern;
    return renderStem(bars * barSec + STEM_TAIL, track.seed + name.length * 7, (ctx, kit, out) => {
      let dest = out;
      if (name === 'kick' && def.drive) {
        const ws = kit.shaper(def.drive);
        ws.connect(out);
        dest = ws;
      }
      if (name === 'clap') dest = fxBus(ctx, kit, dest, { reverb: { size: 1.2, mix: 0.25 } });
      if (name === 'perc') dest = fxBus(ctx, kit, dest, { delay: { time: (60 / bpm) * 0.75, feedback: 0.3, mix: 0.25 } });
      for (let bar = 0; bar < bars; bar++) {
        for (let s = 0; s < 16; s++) {
          const c = pattern[s % pattern.length];
          if (!VEL[c]) continue;
          // light humanisation on hats/percussion
          const human = name === 'kick' ? 1 : 0.85 + kit.rnd() * 0.15;
          const t = bar * barSec + stepTime(s, bpm, name === 'kick' ? 0 : track.swing);
          DRUMS[type](ctx, kit, dest, t, VEL[c] * human, def);
        }
      }
    });
  }

  function fillStem(track) {
    const bpm = track.bpm;
    const type = track.clap && track.clap.type === 'snare' ? 'snare' : 'clap';
    return renderStem(240 / bpm + STEM_TAIL, track.seed + 5, (ctx, kit, out) => {
      for (let s = 8; s < 16; s++) {
        const t = stepTime(s, bpm, 0);
        DRUMS[type](ctx, kit, out, t, 0.35 + ((s - 8) / 8) * 0.65, {});
        if (s >= 12) DRUMS[type](ctx, kit, out, t + 7.5 / bpm, 0.5 + ((s - 12) / 4) * 0.5, {});
      }
    });
  }

  function crashStem(track) {
    return renderStem(3.2, track.seed + 9, (ctx, kit, out) => DRUMS.crash(ctx, kit, out, 0, 1));
  }

  function riserStem(track) {
    const len = (8 * 240) / track.bpm;
    return renderStem(len + 0.2, track.seed + 13, (ctx, kit, out) => {
      const n = kit.noise(0, len);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2;
      bp.frequency.setValueAtTime(250, 0);
      bp.frequency.exponentialRampToValueAtTime(9000, len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.exponentialRampToValueAtTime(1, len - 0.02);
      g.gain.linearRampToValueAtTime(0, len);
      n.connect(bp);
      bp.connect(g);
      g.connect(out);
    });
  }

  function crackleStem(track) {
    const bars = 4;
    const len = Math.ceil(((bars * 240) / track.bpm) * SR);
    const rnd = U.mulberry32(track.seed + 17);
    const L = new Float32Array(len), R = new Float32Array(len);
    let hiss = 0;
    for (let i = 0; i < len; i++) {
      hiss += 0.1 * (rnd() * 2 - 1 - hiss);
      L[i] = R[i] = hiss * 0.15;
      if (rnd() < 0.0004) {
        const amp = rnd() * 0.9;
        for (let j = 0; j < 40 && i + j < len; j++) {
          const v = amp * Math.exp(-j / 6) * (j % 2 ? -1 : 1);
          L[i + j] += v;
          R[i + j] += v * 0.8;
        }
      }
    }
    return Promise.resolve({ L, R, bars });
  }

  function bassStem(track) {
    const def = track.bass;
    const bpm = track.bpm;
    const barSec = 240 / bpm;
    const scale = U.SCALES[track.scale];
    const notes = parseNotes(def.pattern);
    const v = Object.assign({}, VOICES[def.voice]);
    return renderStem(4 * barSec + STEM_TAIL, track.seed + 21, (ctx, kit, out) => {
      v.kit = kit;
      for (let bar = 0; bar < 4; bar++) {
        const rootMidi = U.scaleNote(track.bassRoot, scale, track.progression[bar]);
        for (const n of notes) {
          const t = bar * barSec + stepTime(n.step, bpm, track.swing);
          const dur = n.len * (15 / bpm) * 0.92;
          const vel = n.step % 4 === 2 ? 1 : 0.85;
          voice(ctx, out, t, dur, rootMidi + BASS_INTERVAL[n.ch], vel, v);
        }
      }
    });
  }

  function chordStem(track, def, sustained) {
    const bpm = track.bpm;
    const barSec = 240 / bpm;
    const scale = U.SCALES[track.scale];
    const hits = sustained ? [{ step: 0, len: 16 }] : parseNotes(def.pattern);
    const name = def.voice;
    const v = VOICES[name] && Object.assign({}, VOICES[name]);
    const fx = name === 'darkStab'
      ? { delay: { time: (60 / bpm) * 0.75, feedback: 0.45, mix: 0.45 }, reverb: { size: 2.5, mix: 0.3 } }
      : { reverb: { size: 2.2, mix: sustained ? 0.35 : 0.22 } };
    return renderStem(4 * barSec + STEM_TAIL + (sustained ? 1 : 0), track.seed + (sustained ? 31 : 29), (ctx, kit, out) => {
      const dest = fxBus(ctx, kit, out, fx);
      if (v) v.kit = kit;
      for (let bar = 0; bar < 4; bar++) {
        const notes = U.chordNotes(track.chordRoot, scale, track.progression[bar], def.size || 3);
        for (const h of hits) {
          const t = bar * barSec + stepTime(h.step, bpm, track.swing);
          const dur = h.len * (15 / bpm) * (sustained ? 1.02 : 0.9);
          for (const m of notes) {
            if (name === 'keys') epiano(ctx, dest, t + kit.rnd() * 0.012, dur, m, 0.55);
            else voice(ctx, dest, t, dur, m, 1 / notes.length, v);
          }
        }
      }
    });
  }

  function leadStem(track) {
    const def = track.lead;
    const bpm = track.bpm;
    const barSec = 240 / bpm;
    const sd = 15 / bpm;
    const scale = U.SCALES[track.scale];
    const rnd = U.mulberry32(track.seed * 7 + 3);
    const events = []; // {t, dur, midi, vel, voice?}

    if (def.style === 'acid') {
      const seq = [];
      const degs = [0, 0, 0, 0, 2, 3, 4, 7, -1, 5];
      for (let s = 0; s < 32; s++) {
        if (rnd() < 0.22 && s % 4 !== 0) { seq.push(null); continue; }
        const deg = degs[Math.floor(rnd() * degs.length)];
        seq.push({ deg, oct: rnd() < 0.2 ? 12 : 0, acc: rnd() < 0.3 || s % 8 === 0, len: rnd() < 0.15 ? 2 : 1 });
      }
      for (let rep = 0; rep < 4; rep++) {
        for (let s = 0; s < 32; s++) {
          const n = seq[s];
          if (!n) continue;
          const step = rep * 32 + s;
          events.push({ step, dur: n.len * sd * 0.95, midi: U.scaleNote(track.leadRoot, scale, n.deg) + n.oct, vel: n.acc ? 1 : 0.6 });
        }
      }
    } else if (def.style === 'arp') {
      const order = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 4, 3, 2, 1];
      for (let bar = 0; bar < 4; bar++) {
        const deg = track.progression[bar % 4];
        const tones = U.chordNotes(track.leadRoot, scale, deg, 3);
        tones.push(tones[0] + 12, tones[1] + 12);
        for (let s = 0; s < 16; s++) {
          events.push({ step: bar * 16 + s, dur: sd * 0.9, midi: tones[order[s]], vel: s % 4 === 0 ? 1 : 0.7 });
        }
      }
    } else {
      const lens = def.style === 'keys' ? [2, 3, 4, 6] : [1, 2, 2, 3, 4];
      const A = makeMotif(rnd, 32, def.density || 0.5, lens);
      const B = makeMotif(rnd, 32, def.density || 0.5, lens);
      const form = [A, A, A, B];
      for (let part = 0; part < 4; part++) {
        for (const n of form[part]) {
          const bar = part * 2 + Math.floor(n.step / 16);
          const chordDeg = track.progression[bar % 4];
          events.push({
            step: part * 32 + n.step,
            dur: n.len * sd * 0.9,
            midi: U.scaleNote(track.leadRoot, scale, chordDeg + n.deg),
            vel: n.step % 4 === 0 ? 1 : 0.75,
          });
        }
      }
    }

    const vname = def.style === 'acid' ? 'acid' : def.style === 'arp' ? 'arpLead' : def.dark ? 'darkLead' : 'pluckLead';
    const v = Object.assign({}, VOICES[vname]);
    const fx = def.style === 'acid'
      ? { delay: { time: (60 / bpm) * 0.75, feedback: 0.3, mix: 0.2 } }
      : { delay: { time: (60 / bpm) * 0.75, feedback: 0.35, mix: 0.3 }, reverb: { size: 2.4, mix: 0.3 } };

    const bars = def.style === 'arp' ? 4 : 8; // the arp repeats with the 4-bar progression
    return renderStem(bars * barSec + STEM_TAIL + 1, track.seed + 41, (ctx, kit, out) => {
      v.kit = kit;
      const dest = fxBus(ctx, kit, out, fx);
      for (const e of events) {
        const bar = Math.floor(e.step / 16);
        const t = bar * barSec + stepTime(e.step % 16, bpm, track.swing);
        if (def.style === 'keys') {
          epiano(ctx, dest, t, e.dur, e.midi, 0.7 * e.vel);
        } else if (def.style === 'acid') {
          // filter opens and closes over the 8 bars
          const phase = t / (8 * barSec);
          v.cutoff = 220 + 1600 * (0.5 - 0.5 * Math.cos(phase * 2 * Math.PI));
          v.envAmt = e.vel > 0.8 ? 3200 : 1400;
          voice(ctx, dest, t, e.dur, e.midi, e.vel, v);
        } else {
          voice(ctx, dest, t, e.dur, e.midi, e.vel, v);
        }
      }
    }).then((stem) => Object.assign(stem, { bars }));
  }

  // ------------------------------------------------------------------ levelling
  function rmsDb(stem) {
    let s = 0;
    const n = stem.L.length;
    for (let i = 0; i < n; i++) s += stem.L[i] * stem.L[i] + stem.R[i] * stem.R[i];
    return 10 * Math.log10(s / (2 * n) + 1e-20);
  }

  function peakDb(stem) {
    let p = 1e-9;
    for (let i = 0; i < stem.L.length; i++) p = Math.max(p, Math.abs(stem.L[i]), Math.abs(stem.R[i]));
    return 20 * Math.log10(p);
  }

  function levelStem(name, stem, loopSamples) {
    let gainDb;
    if (PEAK_LEVELS[name] != null) {
      gainDb = PEAK_LEVELS[name] - peakDb(stem);
    } else {
      // measure the loop body only (ignore the tail)
      const body = { L: stem.L.subarray(0, loopSamples), R: stem.R.subarray(0, loopSamples) };
      gainDb = LEVELS[name] - rmsDb(body);
    }
    stem.gain = Math.pow(10, gainDb / 20);
    // drop the silent part of the tail so the arrangement doesn't copy zeros
    const floor = 3e-5 / stem.gain;
    let end = stem.L.length;
    while (end > loopSamples && Math.abs(stem.L[end - 1]) < floor && Math.abs(stem.R[end - 1]) < floor) end--;
    stem.L = stem.L.subarray(0, end);
    stem.R = stem.R.subarray(0, end);
    return stem;
  }

  // ------------------------------------------------------------------ assembly
  /** Per-bar side-chain gain curve derived from the kick pattern. */
  function duckCurve(track, barSamples) {
    const n = Math.ceil(barSamples) + 2;
    const curve = new Float32Array(n);
    const kicks = [];
    for (let s = 0; s < 16; s++) {
      if (VEL[track.kick.pattern[s]]) kicks.push(stepTime(s, track.bpm, 0) * SR);
    }
    const lastKick = kicks[kicks.length - 1] - barSamples; // wraps from previous bar
    const tau = 0.11 * SR;
    let k = 0, prev = lastKick;
    for (let i = 0; i < n; i++) {
      while (k < kicks.length && kicks[k] <= i) prev = kicks[k++];
      curve[i] = 1 - track.duck * Math.exp(-(i - prev) / tau);
    }
    // smooth the attack slightly
    const a = 1 - Math.exp(-1 / (0.002 * SR));
    let y = curve[n - 1];
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        y += a * (curve[i] - y);
        curve[i] = y;
      }
    }
    return curve;
  }

  async function generate(track, onProgress) {
    const arr = ARRANGEMENTS[track.arrangement];
    const bpm = track.bpm;
    const barSamples = (240 / bpm) * SR;
    const progress = onProgress || function () {};

    const jobs = {
      kick: () => drumStem(track, 'kick', track.kick, 1),
      clap: () => track.clap && drumStem(track, 'clap', track.clap, 1),
      hats: () => drumStem(track, 'hats', track.hats, 2),
      hatsOpen: () => track.hatsOpen && drumStem(track, 'hatsOpen', track.hatsOpen, 1),
      perc: () => track.perc && drumStem(track, 'perc', track.perc, 2),
      bass: () => track.bass && bassStem(track),
      chords: () => track.chords && chordStem(track, track.chords, false),
      pad: () => track.pad && chordStem(track, track.pad, true),
      lead: () => track.lead && leadStem(track),
      fill: () => fillStem(track),
      crash: () => crashStem(track),
      riser: () => riserStem(track),
      crackle: () => track.crackle && crackleStem(track),
    };
    const loopBars = { kick: 1, clap: 1, hats: 2, hatsOpen: 1, perc: 2, bass: 4, chords: 4, pad: 4, lead: 8, crackle: 4 };

    const names = Object.keys(jobs);
    const stems = {};
    let done = 0;
    await Promise.all(names.map(async (name) => {
      const s = await jobs[name]();
      if (s) {
        if (s.bars) loopBars[name] = s.bars;
        const loopSamples = Math.round((loopBars[name] || 1) * barSamples);
        stems[name] = levelStem(name, s, Math.min(loopSamples, s.L.length));
      }
      progress(++done / (names.length + 1));
    }));

    // Arrangement: which stem plays in which bar.
    const totalBars = barsOf(arr);
    const length = Math.ceil(totalBars * barSamples + 2.5 * SR);
    const L = new Float32Array(length);
    const R = new Float32Array(length);
    const kickBars = new Uint8Array(totalBars + 8);
    const curve = duckCurve(track, barSamples);

    const place = (name, bar, maxBars) => {
      const s = stems[name];
      if (!s) return;
      const start = Math.round(bar * barSamples);
      const g = s.gain;
      const duckAmt = DUCKED[name] || 0;
      const n = Math.min(s.L.length, length - start);
      // limit a loop to the bars left in its section (with a short fade, keeping it click-free)
      const cutAt = maxBars != null ? Math.round(maxBars * barSamples) : Infinity;
      const fade = 0.02 * SR;
      const sL = s.L, sR = s.R;
      // walk bar by bar so the side-chain curve lookup stays cheap
      for (let b = bar; ; b++) {
        const bs = Math.round(b * barSamples);
        const i0 = Math.max(0, bs - start);
        if (i0 >= n) break;
        const i1 = Math.min(n, Math.round((b + 1) * barSamples) - start);
        const off = start - bs; // curve index = i + off, always inside the bar's curve
        const iMain = Math.min(i1, cutAt);
        if (duckAmt && kickBars[b]) {
          for (let i = i0; i < iMain; i++) {
            const gg = g * (1 - duckAmt * (1 - curve[i + off]));
            L[start + i] += sL[i] * gg;
            R[start + i] += sR[i] * gg;
          }
        } else {
          for (let i = i0; i < iMain; i++) {
            L[start + i] += sL[i] * g;
            R[start + i] += sR[i] * g;
          }
        }
        if (iMain < i1) {
          // fade out a loop cut short by the end of its section
          const iEnd = Math.min(i1, cutAt + fade);
          for (let i = Math.max(i0, cutAt); i < iEnd; i++) {
            const gg = g * (1 - (i - cutAt) / fade);
            L[start + i] += sL[i] * gg;
            R[start + i] += sR[i] * gg;
          }
          if (iEnd < i1) break;
        }
      }
    };

    let bar0 = 0;
    for (const sec of arr) {
      const extra = (track.sections && track.sections[sec.name]) || [];
      const on = sec.on.concat(extra);
      if (on.includes('kick')) for (let b = 0; b < sec.bars; b++) kickBars[bar0 + b] = 1;
      bar0 += sec.bars;
    }

    bar0 = 0;
    arr.forEach((sec, si) => {
      const extra = (track.sections && track.sections[sec.name]) || [];
      const on = sec.on.concat(extra);
      for (const name of on) {
        const lb = loopBars[name] || 1;
        for (let b = 0; b < sec.bars; b += lb) {
          const left = sec.bars - b;
          place(name, bar0 + b, left < lb ? left : null);
        }
      }
      if (sec.crash) place('crash', bar0);
      if (sec.fill && si < arr.length - 1) place('fill', bar0 + sec.bars - 1);
      if (sec.riser) place('riser', bar0 + sec.bars - 8);
      bar0 += sec.bars;
    });

    // Master: normalise and gently saturate for glue/loudness.
    let peak = 1e-9;
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const drive = 1.8;
    const sat = (x) => (x > 3 ? 1 : x < -3 ? -1 : (x * (27 + x * x)) / (27 + 9 * x * x)); // fast tanh
    const norm = 0.89 / sat(drive);
    const pre = drive / peak;
    for (let i = 0; i < length; i++) {
      L[i] = sat(L[i] * pre) * norm;
      R[i] = sat(R[i] * pre) * norm;
    }
    progress(1);
    return { L, R, sampleRate: SR, bpm, firstBeat: 0, duration: length / SR };
  }

  root.DJ = root.DJ || {};
  root.DJ.Synth = { TRACKS, ARRANGEMENTS, generate, SAMPLE_RATE: SR };
})(typeof window !== 'undefined' ? window : globalThis);
