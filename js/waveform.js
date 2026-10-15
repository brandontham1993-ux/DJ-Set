/*
 * Waveform rendering: a zoomable scrolling view (playhead in the centre, beat
 * grid, cues, loop) and a whole-track overview. Colours show frequency bands:
 * blue = bass, orange = mids, white = highs.
 */
(function (root) {
  'use strict';

  const U = root.DJ.util;
  const HOT_COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#eab308'];
  const BAND = {
    low: 'rgba(48, 120, 255, 0.95)',
    mid: 'rgba(255, 166, 43, 0.92)',
    high: 'rgba(240, 244, 255, 0.92)',
  };

  function fitCanvas(canvas) {
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      return true;
    }
    return false;
  }

  class MainWaveform {
    constructor(canvas, deck, accent) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.deck = deck;
      this.accent = accent;
      this.seconds = 8; // visible window
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.seconds = U.clamp(this.seconds * (e.deltaY > 0 ? 1.15 : 1 / 1.15), 2, 32);
      }, { passive: false });

      // drag the waveform to scratch / scrub (like vinyl under your hand)
      canvas.addEventListener('pointerdown', (e) => {
        if (!deck.loaded || e.button !== 0) return;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        let lastX = e.clientX;
        deck.scratchStart();
        const move = (ev) => {
          if (ev.pointerId !== e.pointerId) return;
          const secPerCssPx = this.seconds / canvas.clientWidth;
          deck.scratchMove(-(ev.clientX - lastX) * secPerCssPx);
          lastX = ev.clientX;
        };
        const up = (ev) => {
          if (ev.pointerId !== e.pointerId) return;
          deck.scratchEnd();
          canvas.removeEventListener('pointermove', move);
          canvas.removeEventListener('pointerup', up);
          canvas.removeEventListener('pointercancel', up);
        };
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', up);
      });
    }

    draw() {
      fitCanvas(this.canvas);
      const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
      const deck = this.deck;
      c.fillStyle = '#0b0d12';
      c.fillRect(0, 0, W, H);
      const mid = H / 2;

      if (!deck.loaded) {
        c.fillStyle = '#4b5563';
        c.font = `${Math.round(H * 0.16)}px system-ui, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(`Deck ${deck.id} — load a track from the library`, W / 2, mid);
        return;
      }

      const pos = deck.position;
      const spp = this.seconds / W; // seconds per device pixel
      const t0 = pos - (W / 2) * spp;
      const peaks = deck.track.peaks;
      const xOf = (t) => (t - t0) / spp;

      // loop region
      if (deck.loop.on) {
        c.fillStyle = 'rgba(34, 197, 94, 0.16)';
        c.fillRect(xOf(deck.loop.start), 0, (deck.loop.end - deck.loop.start) / spp, H);
      }

      // beat grid
      if (deck.bpm) {
        const bl = U.beatLength(deck.bpm);
        const firstIdx = Math.ceil((t0 - deck.firstBeat) / bl);
        const lastIdx = Math.floor((t0 + W * spp - deck.firstBeat) / bl);
        for (let i = firstIdx; i <= lastIdx; i++) {
          const x = Math.round(xOf(deck.firstBeat + i * bl)) + 0.5;
          const isBar = ((i % 4) + 4) % 4 === 0;
          c.fillStyle = isBar ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.10)';
          c.fillRect(x, 0, isBar ? 2 : 1, H);
        }
      }

      // waveform (3 overlaid bands)
      const bps = peaks.binsPerSec;
      const amp = mid * 0.92;
      const drawBand = (arr, color, scale) => {
        c.fillStyle = color;
        for (let x = 0; x < W; x++) {
          const tA = t0 + x * spp;
          if (tA < 0) continue;
          let b0 = Math.floor(tA * bps);
          const b1 = Math.max(b0 + 1, Math.floor((tA + spp) * bps));
          if (b0 >= peaks.bins) break;
          let v = 0;
          for (; b0 < b1 && b0 < peaks.bins; b0++) if (arr[b0] > v) v = arr[b0];
          const h = Math.max(1, v * amp * scale);
          c.fillRect(x, mid - h, 1, h * 2);
        }
      };
      drawBand(peaks.low, BAND.low, 1);
      drawBand(peaks.mid, BAND.mid, 0.85);
      drawBand(peaks.high, BAND.high, 0.6);

      // played part dimmed
      c.fillStyle = 'rgba(11, 13, 18, 0.45)';
      c.fillRect(0, 0, W / 2, H);

      // cue + hot cues
      const marker = (t, color, label) => {
        const x = xOf(t);
        if (x < -20 || x > W + 20) return;
        c.fillStyle = color;
        c.fillRect(Math.round(x), 0, 2, H);
        c.beginPath();
        c.moveTo(x - 7, 0);
        c.lineTo(x + 9, 0);
        c.lineTo(x + 1, 10);
        c.closePath();
        c.fill();
        if (label) {
          c.font = `bold ${Math.round(Math.max(10, H * 0.12))}px system-ui, sans-serif`;
          c.textAlign = 'left';
          c.textBaseline = 'bottom';
          c.fillText(label, Math.max(4, x + 5), H - 4);
        }
      };
      marker(deck.cuePoint, '#f97316', 'CUE');
      deck.hotCues.forEach((t, i) => t != null && marker(t, HOT_COLORS[i], String(i + 1)));

      // playhead
      c.fillStyle = this.accent;
      c.fillRect(Math.round(W / 2) - 1, 0, 3, H);
    }
  }

  class Overview {
    constructor(canvas, deck, accent) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.deck = deck;
      this.accent = accent;
      this.cache = null;
      this.cacheKey = null;

      canvas.addEventListener('pointerdown', (e) => {
        if (!deck.loaded || e.button !== 0) return;
        canvas.setPointerCapture(e.pointerId);
        const seekTo = (ev) => {
          const r = canvas.getBoundingClientRect();
          deck.seek(U.clamp((ev.clientX - r.left) / r.width, 0, 1) * deck.length);
        };
        seekTo(e);
        const up = () => {
          canvas.removeEventListener('pointermove', seekTo);
          canvas.removeEventListener('pointerup', up);
        };
        canvas.addEventListener('pointermove', seekTo);
        canvas.addEventListener('pointerup', up);
      });
    }

    _renderCache(W, H) {
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const c = off.getContext('2d');
      const p = this.deck.track.peaks;
      const mid = H / 2;
      const perPx = p.bins / W;
      const bands = [[p.low, BAND.low, 1], [p.mid, BAND.mid, 0.85], [p.high, BAND.high, 0.6]];
      for (const [arr, color, scale] of bands) {
        c.fillStyle = color;
        for (let x = 0; x < W; x++) {
          let v = 0;
          const b1 = Math.min(p.bins, Math.floor((x + 1) * perPx));
          for (let b = Math.floor(x * perPx); b < b1; b++) if (arr[b] > v) v = arr[b];
          const h = Math.max(0.5, v * mid * 0.95 * scale);
          c.fillRect(x, mid - h, 1, h * 2);
        }
      }
      return off;
    }

    draw() {
      fitCanvas(this.canvas);
      const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
      const deck = this.deck;
      c.fillStyle = '#0b0d12';
      c.fillRect(0, 0, W, H);
      if (!deck.loaded) return;
      const key = deck.track.uid + ':' + W + 'x' + H;
      if (this.cacheKey !== key) {
        this.cache = this._renderCache(W, H);
        this.cacheKey = key;
      }
      c.drawImage(this.cache, 0, 0);
      const xOf = (t) => (t / deck.length) * W;
      const px = xOf(deck.position);
      c.fillStyle = 'rgba(11, 13, 18, 0.55)';
      c.fillRect(0, 0, px, H);
      if (deck.loop.on) {
        c.fillStyle = 'rgba(34, 197, 94, 0.45)';
        c.fillRect(xOf(deck.loop.start), 0, Math.max(2, xOf(deck.loop.end) - xOf(deck.loop.start)), H);
      }
      c.fillStyle = '#f97316';
      c.fillRect(Math.round(xOf(deck.cuePoint)), 0, 2, H);
      deck.hotCues.forEach((t, i) => {
        if (t == null) return;
        c.fillStyle = HOT_COLORS[i];
        c.fillRect(Math.round(xOf(t)), 0, 2, H);
      });
      // last 30 seconds warning zone
      c.fillStyle = 'rgba(239, 68, 68, 0.18)';
      c.fillRect(xOf(Math.max(0, deck.length - 30)), H - 4, W, 4);
      c.fillStyle = this.accent;
      c.fillRect(Math.round(px) - 1, 0, 3, H);
    }
  }

  root.DJ = root.DJ || {};
  root.DJ.MainWaveform = MainWaveform;
  root.DJ.Overview = Overview;
  root.DJ.HOT_COLORS = HOT_COLORS;
})(typeof window !== 'undefined' ? window : globalThis);
