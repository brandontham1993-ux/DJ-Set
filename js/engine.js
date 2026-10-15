/*
 * Audio engine: two decks, a two-channel mixer, master bus, split-cue
 * headphone routing and mix recording.
 *
 * Deck signal flow:
 *   player (worklet) -> trim -> low/mid/high EQ -> filter (LP+HP) -> post
 *   post -> fader -> crossfader -> master
 *   post -> fx send -> echo | reverb | flanger -> fx return -> fader
 *   post -> PFL (headphone cue) -> cue bus
 */
(function (root) {
  'use strict';

  const U = root.DJ.util;

  const ramp = (param, value, ctx, tc) => param.setTargetAtTime(value, ctx.currentTime, tc || 0.012);

  class Deck {
    constructor(engine, id) {
      this.engine = engine;
      this.id = id;
      const ctx = (this.ctx = engine.ctx);

      this.player = new AudioWorkletNode(ctx, 'deck-player', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.player.port.onmessage = (e) => this._onPlayerMessage(e.data);

      // --- channel strip
      this.trim = ctx.createGain();
      this.eq = {
        low: Object.assign(ctx.createBiquadFilter(), { type: 'lowshelf' }),
        mid: Object.assign(ctx.createBiquadFilter(), { type: 'peaking' }),
        high: Object.assign(ctx.createBiquadFilter(), { type: 'highshelf' }),
      };
      this.eq.low.frequency.value = 220;
      this.eq.mid.frequency.value = 1000;
      this.eq.mid.Q.value = 0.6;
      this.eq.high.frequency.value = 3500;
      this.lp = Object.assign(ctx.createBiquadFilter(), { type: 'lowpass' });
      this.hp = Object.assign(ctx.createBiquadFilter(), { type: 'highpass' });
      this.lp.Q.value = 1.1;
      this.hp.Q.value = 1.1;
      this.lp.frequency.value = 22000;
      this.hp.frequency.value = 10;
      this.post = ctx.createGain();
      this.fader = ctx.createGain();
      this.xfade = ctx.createGain();
      this.pfl = ctx.createGain();
      this.pfl.gain.value = 0;
      this.meter = ctx.createAnalyser();
      this.meter.fftSize = 1024;

      this.player.connect(this.trim);
      this.trim.connect(this.eq.low);
      this.eq.low.connect(this.eq.mid);
      this.eq.mid.connect(this.eq.high);
      this.eq.high.connect(this.lp);
      this.lp.connect(this.hp);
      this.hp.connect(this.post);
      this.post.connect(this.fader);
      this.post.connect(this.meter);
      this.post.connect(this.pfl);
      this.pfl.connect(engine.cueBus);
      this.fader.connect(this.xfade);
      this.xfade.connect(engine.masterIn);

      this._buildFx();

      // --- state
      this.track = null;
      this.sampleRate = 44100;
      this.length = 0; // seconds
      this.playing = false;
      this.cuePoint = 0;
      this.cuePreview = false;
      this.hotCues = [null, null, null, null];
      this.loop = { on: false, start: 0, end: 0, beats: 4 };
      this.pitch = 0; // fader position -1..1
      this.pitchRange = 0.08;
      this.bend = 0;
      this.quantize = true;
      this.vinyl = true;
      this.kills = { low: false, mid: false, high: false };
      this.eqValues = { low: 0, mid: 0, high: 0 };
      this.volume = 0.8;
      this.fxOn = false;
      this.fxType = 'echo';
      this.fxAmount = 0.5;
      this.fxBeats = 0.5;
      this.pflOn = false;

      this._seq = 0;
      this._pos = 0; // buffer samples, last report
      this._rate = 0;
      this._t = 0;
      this.listeners = new Set();

      this.setVolume(this.volume);
      this.setFxAmount(this.fxAmount);
      this.setFxType(this.fxType);
    }

    // ------------------------------------------------------------ events
    on(fn) {
      this.listeners.add(fn);
    }
    _emit(what) {
      for (const fn of this.listeners) fn(what, this);
    }

    _onPlayerMessage(m) {
      if (m.type === 'pos') {
        if (m.seq !== this._seq) return; // stale report from before a seek/load
        this._pos = m.pos;
        this._rate = m.rate;
        this._t = m.t;
      } else if (m.type === 'ended') {
        this.playing = false;
        this.cuePreview = false;
        this._emit('state');
      }
    }

    // ------------------------------------------------------------ loading
    get loaded() {
      return !!this.track;
    }

    /**
     * Load decoded audio. L/R are transferred to the audio thread.
     * meta: {title, artist, bpm, firstBeat, key, camelot, peaks}
     */
    load(meta, L, R, sampleRate) {
      this.pause();
      this.track = meta;
      this.sampleRate = sampleRate;
      this.length = L.length / sampleRate;
      this.cuePoint = meta.firstBeat || 0;
      this.hotCues = [null, null, null, null];
      this.loop.on = false;
      this.bend = 0;
      this._seq++;
      this._pos = this.cuePoint * sampleRate;
      this._rate = 0;
      this._t = this.ctx.currentTime;
      const transfer = R && R !== L ? [L.buffer, R.buffer] : [L.buffer];
      this.player.port.postMessage({ type: 'load', L, R: R || L, sampleRate, seq: this._seq }, transfer);
      this._sendTempo();
      this.seek(this.cuePoint);
      this._updateEcho();
      this._emit('load');
    }

    // ------------------------------------------------------------ transport
    /** Current playhead in seconds (interpolated between audio-thread reports). */
    get position() {
      if (!this.loaded) return 0;
      const elapsed = Math.max(0, this.ctx.currentTime - this._t);
      let p = this._pos + elapsed * this._rate * this.ctx.sampleRate;
      if (this.loop.on && this._rate > 0) {
        const s = this.loop.start * this.sampleRate, e = this.loop.end * this.sampleRate;
        if (p >= e) p = s + ((p - s) % (e - s));
      }
      return U.clamp(p / this.sampleRate, 0, this.length);
    }

    play() {
      if (!this.loaded) return;
      this.engine.resume();
      this.cuePreview = false;
      this.playing = true;
      this.player.port.postMessage({ type: 'play' });
      this._emit('state');
    }

    pause() {
      this.playing = false;
      this.cuePreview = false;
      this.player.port.postMessage({ type: 'pause' });
      this._emit('state');
    }

    togglePlay() {
      if (this.playing) this.pause();
      else this.play();
    }

    seek(sec) {
      if (!this.loaded) return;
      sec = U.clamp(sec, 0, this.length - 0.01);
      if (this.loop.on && (sec < this.loop.start - 0.001 || sec > this.loop.end)) this.loopOff();
      this._seq++;
      this._pos = sec * this.sampleRate;
      this._t = this.ctx.currentTime;
      this.player.port.postMessage({ type: 'seek', pos: this._pos, seq: this._seq });
    }

    /** CDJ style cue: set / return / hold to preview. */
    cueDown() {
      if (!this.loaded) return;
      if (this.playing && !this.cuePreview) {
        this.pause();
        this.seek(this.cuePoint);
        return;
      }
      const pos = this.position;
      if (Math.abs(pos - this.cuePoint) < 0.02) {
        this.play();
        this.cuePreview = true;
      } else {
        this.cuePoint = this.snap(pos);
        this.seek(this.cuePoint);
        this._emit('cues');
      }
    }

    cueUp() {
      if (!this.cuePreview) return;
      this.pause();
      this.seek(this.cuePoint);
    }

    hotCue(i) {
      if (!this.loaded) return;
      if (this.hotCues[i] == null) {
        this.hotCues[i] = this.snap(this.position);
        this._emit('cues');
      } else {
        this.seek(this.hotCues[i]);
        if (!this.playing) this.cuePoint = this.hotCues[i];
      }
    }

    deleteHotCue(i) {
      this.hotCues[i] = null;
      this._emit('cues');
    }

    // ------------------------------------------------------------ beat grid
    get bpm() {
      return this.track ? this.track.bpm : 0;
    }
    get firstBeat() {
      return this.track ? this.track.firstBeat || 0 : 0;
    }
    get tempoRatio() {
      return 1 + this.pitch * this.pitchRange;
    }
    get currentBpm() {
      return this.bpm * this.tempoRatio;
    }

    snap(sec) {
      if (!this.quantize || !this.bpm) return sec;
      return Math.max(0, U.nearestBeat(sec, this.bpm, this.firstBeat));
    }

    beatPhase(sec) {
      return U.beatPhase(sec == null ? this.position : sec, this.bpm, this.firstBeat);
    }

    // ------------------------------------------------------------ tempo
    setPitch(p) {
      this.pitch = U.clamp(p, -1, 1);
      this._sendTempo();
      this._updateEcho();
      this._emit('tempo');
    }

    /** Change tempo by a percentage (e.g. 0.1 = +0.1%). */
    nudgeTempo(percent) {
      this.setPitch(this.pitch + percent / 100 / this.pitchRange);
    }

    cyclePitchRange() {
      const ratio = this.tempoRatio;
      const ranges = [0.08, 0.16, 0.5];
      this.pitchRange = ranges[(ranges.indexOf(this.pitchRange) + 1) % ranges.length];
      this.setPitch((ratio - 1) / this.pitchRange); // keep the current tempo if it fits
    }

    resetPitch() {
      this.setPitch(0);
    }

    _sendTempo() {
      this.player.port.postMessage({ type: 'tempo', value: this.tempoRatio });
    }

    setBend(b) {
      this.bend = b;
      this.player.port.postMessage({ type: 'bend', value: b });
    }

    /** Match tempo (and beat phase if the other deck is playing). */
    sync(other) {
      if (!this.loaded || !other || !other.loaded || !this.bpm || !other.bpm) return false;
      const { ratio, mult } = U.syncRatio(this.bpm, other.currentBpm);
      const needed = Math.abs(ratio - 1);
      if (needed > this.pitchRange) this.pitchRange = needed > 0.16 ? 0.5 : 0.16;
      this.setPitch((ratio - 1) / this.pitchRange);
      if (other.playing) {
        // Phase in "other's beats": a double-time partner covers 2 of our beats per its beat.
        const myBeat = U.beatAt(this.position, this.bpm, this.firstBeat);
        const otherBeat = U.beatAt(other.position, other.bpm, other.firstBeat) * mult;
        const delta = U.phaseDelta(myBeat - Math.floor(myBeat), otherBeat - Math.floor(otherBeat));
        const target = this.position + delta * U.beatLength(this.bpm);
        // Keep an active loop intact when the shift stays inside it.
        if (this.loop.on && target >= this.loop.start && target < this.loop.end) {
          this._seq++;
          this._pos = target * this.sampleRate;
          this._t = this.ctx.currentTime;
          this.player.port.postMessage({ type: 'seek', pos: this._pos, seq: this._seq });
        } else {
          this.seek(target);
        }
      }
      return true;
    }

    // ------------------------------------------------------------ jog / scratch
    scratchStart() {
      if (!this.loaded) return;
      this._scratchPos = this.position * this.sampleRate;
      this.player.port.postMessage({ type: 'scratchStart' });
    }

    /** Move the record under the "hand" by deltaSec of audio. */
    scratchMove(deltaSec) {
      if (this._scratchPos == null) return;
      this._scratchPos = U.clamp(this._scratchPos + deltaSec * this.sampleRate, 0, this.length * this.sampleRate);
      this.player.port.postMessage({ type: 'scratchMove', pos: this._scratchPos });
    }

    scratchEnd() {
      if (this._scratchPos == null) return;
      this._scratchPos = null;
      this.player.port.postMessage({ type: 'scratchEnd' });
    }

    get scratching() {
      return this._scratchPos != null;
    }

    // ------------------------------------------------------------ loops
    _sendLoop() {
      this.player.port.postMessage({
        type: 'loop',
        on: this.loop.on,
        start: this.loop.start * this.sampleRate,
        end: this.loop.end * this.sampleRate,
      });
      this._emit('loop');
    }

    loopOn(beats) {
      if (!this.loaded || !this.bpm) return;
      if (beats) this.loop.beats = beats;
      const pos = this.position;
      const start = this.quantize ? Math.max(0, U.previousBeat(pos, this.bpm, this.firstBeat)) : pos;
      this.loop.start = start;
      this.loop.end = Math.min(this.length, start + this.loop.beats * U.beatLength(this.bpm));
      this.loop.on = true;
      this._sendLoop();
    }

    loopOff() {
      if (!this.loop.on) return;
      this.loop.on = false;
      this._sendLoop();
    }

    loopToggle() {
      if (this.loop.on) this.loopOff();
      else this.loopOn();
    }

    loopResize(factor) {
      const beats = U.clamp(this.loop.beats * factor, 1 / 8, 64);
      this.loop.beats = beats;
      if (this.loop.on) {
        this.loop.end = Math.min(this.length, this.loop.start + beats * U.beatLength(this.bpm));
        this._sendLoop();
      } else {
        this._emit('loop');
      }
    }

    // ------------------------------------------------------------ mixer
    setTrim(v) {
      ramp(this.trim.gain, U.trimKnobToGain(v), this.ctx);
    }

    setEq(band, v) {
      this.eqValues[band] = v;
      this._applyEq(band);
    }

    toggleKill(band) {
      this.kills[band] = !this.kills[band];
      this._applyEq(band);
      this._emit('eq');
    }

    _applyEq(band) {
      const db = this.kills[band] ? -60 : U.eqKnobToDb(this.eqValues[band]);
      ramp(this.eq[band].gain, db, this.ctx);
    }

    setFilter(v) {
      const f = U.filterKnobToFreqs(v);
      ramp(this.lp.frequency, f.lp, this.ctx, 0.02);
      ramp(this.hp.frequency, f.hp, this.ctx, 0.02);
    }

    setVolume(v) {
      this.volume = U.clamp(v, 0, 1);
      ramp(this.fader.gain, U.faderToGain(this.volume), this.ctx, 0.008);
      this._emit('volume');
    }

    setXfadeGain(g) {
      ramp(this.xfade.gain, g, this.ctx, 0.008);
    }

    setPfl(on) {
      this.pflOn = on;
      ramp(this.pfl.gain, on ? 1 : 0, this.ctx);
      this._emit('pfl');
    }

    /** Peak level (0..1) of the pre-fader signal. */
    level() {
      if (!this._meterBuf) this._meterBuf = new Float32Array(this.meter.fftSize);
      this.meter.getFloatTimeDomainData(this._meterBuf);
      let p = 0;
      for (let i = 0; i < this._meterBuf.length; i++) p = Math.max(p, Math.abs(this._meterBuf[i]));
      return p;
    }

    // ------------------------------------------------------------ fx
    _buildFx() {
      const ctx = this.ctx;
      this.fxSend = ctx.createGain();
      this.fxSend.gain.value = 0;
      this.fxReturn = ctx.createGain();
      this.post.connect(this.fxSend);
      this.fxReturn.connect(this.fader);

      // echo (tempo synced, filtered feedback)
      this.echo = ctx.createDelay(4);
      const echoFb = ctx.createGain();
      echoFb.gain.value = 0.5;
      const echoLp = ctx.createBiquadFilter();
      echoLp.type = 'lowpass';
      echoLp.frequency.value = 3500;
      this.echoOut = ctx.createGain();
      this.fxSend.connect(this.echo);
      this.echo.connect(echoLp);
      echoLp.connect(echoFb);
      echoFb.connect(this.echo);
      echoLp.connect(this.echoOut);
      this.echoOut.connect(this.fxReturn);

      // reverb
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.engine.reverbImpulse;
      this.reverbOut = ctx.createGain();
      this.fxSend.connect(this.reverb);
      this.reverb.connect(this.reverbOut);
      this.reverbOut.connect(this.fxReturn);

      // flanger
      this.flanger = ctx.createDelay(0.05);
      this.flanger.delayTime.value = 0.004;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.2;
      const depth = ctx.createGain();
      depth.gain.value = 0.0032;
      lfo.connect(depth);
      depth.connect(this.flanger.delayTime);
      lfo.start();
      const flFb = ctx.createGain();
      flFb.gain.value = 0.65;
      this.flangerOut = ctx.createGain();
      this.fxSend.connect(this.flanger);
      this.flanger.connect(flFb);
      flFb.connect(this.flanger);
      this.flanger.connect(this.flangerOut);
      this.flangerOut.connect(this.fxReturn);
    }

    setFxType(type) {
      this.fxType = type;
      ramp(this.echoOut.gain, type === 'echo' ? 1 : 0, this.ctx);
      ramp(this.reverbOut.gain, type === 'reverb' ? 1 : 0, this.ctx);
      ramp(this.flangerOut.gain, type === 'flanger' ? 1 : 0, this.ctx);
      this._emit('fx');
    }

    setFxAmount(v) {
      this.fxAmount = U.clamp(v, 0, 1);
      ramp(this.fxReturn.gain, this.fxAmount * 1.1, this.ctx);
    }

    setFxBeats(beats) {
      this.fxBeats = beats;
      this._updateEcho();
      this._emit('fx');
    }

    toggleFx() {
      this.fxOn = !this.fxOn;
      // turning off closes the send only, so echo/reverb tails ring out naturally
      ramp(this.fxSend.gain, this.fxOn ? 1 : 0, this.ctx);
      this._emit('fx');
    }

    _updateEcho() {
      const bpm = this.currentBpm || 120;
      const t = U.clamp((60 / bpm) * this.fxBeats, 0.01, 3.9);
      ramp(this.echo.delayTime, t, this.ctx, 0.05);
    }
  }

  class AudioEngine {
    async init() {
      const Ctx = root.AudioContext || root.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      const ctx = this.ctx;
      const src = root.DJ.PROCESSOR_SOURCE;
      try {
        await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
      } catch (e) {
        // blob: URLs are refused when the page is opened from disk (file://); data: URLs work there
        await ctx.audioWorklet.addModule('data:application/javascript;charset=utf-8,' + encodeURIComponent(src));
      }

      this.reverbImpulse = this._makeImpulse(2.8);

      this.masterIn = ctx.createGain();
      this.masterGain = ctx.createGain();
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -3;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.15;
      this.masterOut = ctx.createGain();
      this.masterIn.connect(this.masterGain);
      this.masterGain.connect(this.limiter);
      this.limiter.connect(this.masterOut);

      this.masterMeterL = ctx.createAnalyser();
      this.masterMeterR = ctx.createAnalyser();
      this.masterMeterL.fftSize = this.masterMeterR.fftSize = 1024;
      const split = ctx.createChannelSplitter(2);
      this.masterOut.connect(split);
      split.connect(this.masterMeterL, 0);
      split.connect(this.masterMeterR, 1);

      // headphone cue bus (mono) and split-cue output (L = cue, R = master)
      this.cueBus = ctx.createGain();
      this.cueBus.channelCount = 1;
      this.cueBus.channelCountMode = 'explicit';
      this.masterMono = ctx.createGain();
      this.masterMono.channelCount = 1;
      this.masterMono.channelCountMode = 'explicit';
      this.splitMerger = ctx.createChannelMerger(2);
      this.cueBus.connect(this.splitMerger, 0, 0);
      this.masterOut.connect(this.masterMono);
      this.masterMono.connect(this.splitMerger, 0, 1);
      this.splitCue = false;
      this.masterOut.connect(ctx.destination);

      this.recordDest = ctx.createMediaStreamDestination();
      this.masterOut.connect(this.recordDest);

      this.crossfader = 0;
      this.xfCurve = 'smooth';
      this.decks = { A: new Deck(this, 'A'), B: new Deck(this, 'B') };
      this.setCrossfader(0);
      this.setMasterVolume(0.8);
    }

    resume() {
      if (this.ctx.state !== 'running') this.ctx.resume();
    }

    _makeImpulse(seconds) {
      const len = Math.floor(seconds * this.ctx.sampleRate);
      const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
      const rnd = U.mulberry32(99);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          lp += 0.4 * (rnd() * 2 - 1 - lp);
          d[i] = lp * Math.pow(1 - i / len, 3);
        }
      }
      return buf;
    }

    setCrossfader(x) {
      this.crossfader = U.clamp(x, -1, 1);
      const g = U.crossfaderGains(this.crossfader, this.xfCurve);
      this.decks.A.setXfadeGain(g.a);
      this.decks.B.setXfadeGain(g.b);
    }

    setCrossfaderCurve(curve) {
      this.xfCurve = curve;
      this.setCrossfader(this.crossfader);
    }

    setMasterVolume(v) {
      this.masterVolume = U.clamp(v, 0, 1);
      ramp(this.masterGain.gain, U.faderToGain(this.masterVolume) * 1.25, this.ctx);
    }

    setSplitCue(on) {
      this.splitCue = on;
      try {
        if (on) {
          this.masterOut.disconnect(this.ctx.destination);
          this.splitMerger.connect(this.ctx.destination);
        } else {
          this.splitMerger.disconnect(this.ctx.destination);
          this.masterOut.connect(this.ctx.destination);
        }
      } catch (e) {
        /* already in requested state */
      }
    }

    masterLevels() {
      if (!this._mBuf) this._mBuf = new Float32Array(1024);
      const peak = (an) => {
        an.getFloatTimeDomainData(this._mBuf);
        let p = 0;
        for (let i = 0; i < this._mBuf.length; i++) p = Math.max(p, Math.abs(this._mBuf[i]));
        return p;
      };
      return [peak(this.masterMeterL), peak(this.masterMeterR)];
    }

    // ------------------------------------------------------------ recording
    get recording() {
      return !!(this.recorder && this.recorder.state === 'recording');
    }

    startRecording() {
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const mimeType = types.find((t) => root.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      this.recChunks = [];
      this.recorder = new MediaRecorder(this.recordDest.stream, mimeType ? { mimeType, audioBitsPerSecond: 192000 } : undefined);
      this.recorder.ondataavailable = (e) => e.data.size && this.recChunks.push(e.data);
      this.recorder.start(1000);
      this.recStart = performance.now();
    }

    stopRecording() {
      return new Promise((resolve) => {
        if (!this.recorder) return resolve(null);
        this.recorder.onstop = () => {
          const type = this.recorder.mimeType || 'audio/webm';
          resolve(new Blob(this.recChunks, { type }));
        };
        this.recorder.stop();
      });
    }
  }

  root.DJ = root.DJ || {};
  root.DJ.AudioEngine = AudioEngine;
  root.DJ.Deck = Deck;
})(typeof window !== 'undefined' ? window : globalThis);
