/*
 * AudioWorklet "turntable". It is defined as a function and turned into a Blob
 * URL at runtime so the app also works when index.html is opened straight from
 * disk (file://), where addModule() of a real file is blocked.
 *
 * Positions are in buffer samples. Rates are buffer samples per output sample.
 * Audio is stored as Int16 (half the memory of Float32, which matters on phones).
 */
(function (root) {
  'use strict';

  function processorMain() {
    class DeckPlayer extends AudioWorkletProcessor {
      constructor() {
        super();
        this.L = null;
        this.R = null;
        this.len = 0;
        this.srRatio = 1;
        this.pos = 0;
        this.playing = false;
        this.tempo = 1;
        this.bend = 0;
        this.rate = 0;
        this.scratching = false;
        this.scratchTarget = 0;
        this.loopOn = false;
        this.loopStart = 0;
        this.loopEnd = 0;
        this.seq = 0;
        this.blocks = 0;
        this.port.onmessage = (e) => this.onMessage(e.data);
      }

      onMessage(m) {
        switch (m.type) {
          case 'load':
            this.L = m.L;
            this.R = m.R || m.L;
            this.len = this.L.length;
            this.srRatio = m.sampleRate / sampleRate;
            this.pos = 0;
            this.rate = 0;
            this.playing = false;
            this.scratching = false;
            this.loopOn = false;
            this.seq = m.seq;
            break;
          case 'play':
            this.playing = true;
            break;
          case 'pause':
            this.playing = false;
            break;
          case 'seek':
            this.pos = Math.max(0, Math.min(this.len - 2, m.pos));
            this.scratchTarget = this.pos;
            this.seq = m.seq;
            break;
          case 'tempo':
            this.tempo = m.value;
            break;
          case 'bend':
            this.bend = m.value;
            break;
          case 'scratchStart':
            this.scratching = true;
            this.scratchTarget = this.pos;
            break;
          case 'scratchMove':
            this.scratchTarget = Math.max(0, Math.min(this.len - 2, m.pos));
            break;
          case 'scratchEnd':
            this.scratching = false;
            break;
          case 'loop':
            this.loopOn = m.on;
            this.loopStart = m.start;
            this.loopEnd = m.end;
            if (this.loopOn && this.pos >= this.loopEnd) {
              const span = this.loopEnd - this.loopStart;
              this.pos = this.loopStart + ((this.pos - this.loopStart) % span);
            }
            break;
        }
      }

      process(inputs, outputs) {
        const out = outputs[0];
        const oL = out[0];
        const oR = out[1] || out[0];
        const n = oL.length;
        if (!this.L || this.len < 2) {
          oL.fill(0);
          if (oR !== oL) oR.fill(0);
          return true;
        }
        const L = this.L, R = this.R, last = this.len - 2;
        const maxRate = 12 * this.srRatio;
        const scratchTau = 0.012 * sampleRate;
        let ended = false;

        for (let i = 0; i < n; i++) {
          let target;
          let k;
          if (this.scratching) {
            target = (this.scratchTarget - this.pos) / scratchTau;
            if (target > maxRate) target = maxRate;
            else if (target < -maxRate) target = -maxRate;
            k = 0.02;
          } else {
            target = this.playing ? this.tempo * (1 + this.bend) * this.srRatio : 0;
            k = 0.01;
          }
          this.rate += (target - this.rate) * k;
          if (Math.abs(this.rate) < 1e-6 && target === 0) this.rate = 0;

          let pos = this.pos + this.rate;
          if (this.loopOn && this.rate > 0 && pos >= this.loopEnd) pos -= this.loopEnd - this.loopStart;
          if (pos < 0) pos = 0;
          if (pos > last) {
            pos = last;
            if (this.playing && !this.scratching) {
              this.playing = false;
              ended = true;
            }
          }
          this.pos = pos;

          const i0 = pos | 0;
          const f = pos - i0;
          // Fade out as the platter slows so a stopped deck is silent (no DC/clicks).
          let amp = Math.abs(this.rate) / (0.03 * this.srRatio);
          if (amp > 1) amp = 1;
          amp *= 1 / 32768;
          oL[i] = (L[i0] + (L[i0 + 1] - L[i0]) * f) * amp;
          if (oR !== oL) oR[i] = (R[i0] + (R[i0 + 1] - R[i0]) * f) * amp;
        }

        if (ended) this.port.postMessage({ type: 'ended' });
        if (++this.blocks % 3 === 0 || ended) {
          this.port.postMessage({
            type: 'pos',
            pos: this.pos,
            rate: this.rate,
            playing: this.playing,
            seq: this.seq,
            t: currentTime,
          });
        }
        return true;
      }
    }
    registerProcessor('deck-player', DeckPlayer);
  }

  root.DJ = root.DJ || {};
  root.DJ.PROCESSOR_SOURCE = '(' + processorMain.toString() + ')();';
})(typeof window !== 'undefined' ? window : globalThis);
