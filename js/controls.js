/*
 * Mouse-driven mixer controls.
 *   Knob:  drag up/down (hold Shift for fine), scroll wheel, double-click to reset.
 *   Fader: drag, click on the track to jump, scroll wheel, double-click to reset.
 */
(function (root) {
  'use strict';

  const U = root.DJ.util;
  const SVGNS = 'http://www.w3.org/2000/svg';

  function polar(cx, cy, r, deg) {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  function arcPath(cx, cy, r, a0, a1) {
    if (Math.abs(a1 - a0) < 0.01) return '';
    const [x0, y0] = polar(cx, cy, r, Math.min(a0, a1));
    const [x1, y1] = polar(cx, cy, r, Math.max(a0, a1));
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  }

  class Knob {
    constructor(el, opts) {
      this.el = el;
      this.min = opts.min == null ? -1 : opts.min;
      this.max = opts.max == null ? 1 : opts.max;
      this.def = opts.value == null ? 0 : opts.value;
      this.bipolar = opts.bipolar !== false && this.min < 0;
      this.onChange = opts.onChange || function () {};
      this.value = this.def;

      el.classList.add('knob');
      if (opts.className) el.classList.add(opts.className);
      el.tabIndex = -1;
      el.title = (opts.title || opts.label || '') + ' — drag, scroll or double-click to reset';
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('viewBox', '0 0 40 40');
      svg.innerHTML =
        '<circle class="knob-body" cx="20" cy="20" r="13"></circle>' +
        '<path class="knob-track" d="' + arcPath(20, 20, 17, -135, 135) + '"></path>' +
        '<path class="knob-arc"></path>' +
        '<line class="knob-pointer" x1="20" y1="20" x2="20" y2="9"></line>';
      el.appendChild(svg);
      this.arc = svg.querySelector('.knob-arc');
      this.pointer = svg.querySelector('.knob-pointer');
      if (opts.label) {
        const lab = document.createElement('span');
        lab.className = 'knob-label';
        lab.textContent = opts.label;
        el.appendChild(lab);
      }

      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        let lastY = e.clientY;
        el.classList.add('active');
        const move = (ev) => {
          const dy = lastY - ev.clientY;
          lastY = ev.clientY;
          const sens = ev.shiftKey ? 600 : 160;
          this.set(this.value + (dy / sens) * (this.max - this.min));
        };
        const up = () => {
          el.classList.remove('active');
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      });
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = (e.shiftKey ? 0.005 : 0.025) * (this.max - this.min);
        this.set(this.value - Math.sign(e.deltaY) * step);
      }, { passive: false });
      el.addEventListener('dblclick', () => this.set(this.def));
      this.render();
    }

    set(v, emit) {
      v = U.clamp(v, this.min, this.max);
      // gentle detent at the centre of bipolar knobs
      if (this.bipolar && Math.abs(v) < 0.015 * (this.max - this.min)) v = 0;
      this.value = v;
      this.render();
      if (emit !== false) this.onChange(v);
    }

    render() {
      const f = (this.value - this.min) / (this.max - this.min);
      const ang = -135 + f * 270;
      const from = this.bipolar ? 0 : -135;
      this.arc.setAttribute('d', arcPath(20, 20, 17, from, ang));
      this.pointer.setAttribute('transform', `rotate(${ang} 20 20)`);
    }
  }

  class Fader {
    constructor(el, opts) {
      this.el = el;
      this.min = opts.min == null ? 0 : opts.min;
      this.max = opts.max == null ? 1 : opts.max;
      this.def = opts.value == null ? this.min : opts.value;
      this.vertical = opts.orientation !== 'horizontal';
      this.invert = !!opts.invert;
      this.onChange = opts.onChange || function () {};
      this.value = this.def;

      el.classList.add('fader', this.vertical ? 'vertical' : 'horizontal');
      if (opts.className) el.classList.add(opts.className);
      el.title = (opts.title || '') + ' — drag, scroll or double-click to reset';
      el.innerHTML = '<div class="fader-track"><div class="fader-center"></div></div><div class="fader-thumb"></div>';
      this.thumb = el.querySelector('.fader-thumb');
      if (opts.centerMark) el.classList.add('has-center');

      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const rect = el.getBoundingClientRect();
        const onThumb = e.target === this.thumb;
        const start = this._fraction();
        const startPos = this.vertical ? e.clientY : e.clientX;
        const size = this.vertical ? rect.height : rect.width;
        if (!onThumb) this._setFromPointer(e, rect);
        const base = onThumb ? start : this._fraction();
        const basePos = onThumb ? startPos : this.vertical ? e.clientY : e.clientX;
        el.classList.add('active');
        const move = (ev) => {
          const d = ((this.vertical ? ev.clientY : ev.clientX) - basePos) / size;
          const scale = ev.shiftKey ? 0.25 : 1;
          this._setFraction(base + d * scale);
        };
        const up = () => {
          el.classList.remove('active');
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      });
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        // scroll down moves a vertical thumb down; scroll up moves a horizontal thumb right
        const step = e.shiftKey ? 0.004 : 0.025;
        const dir = this.vertical ? Math.sign(e.deltaY) : -Math.sign(e.deltaY);
        this._setFraction(this._fraction() + dir * step);
      }, { passive: false });
      el.addEventListener('dblclick', () => this.set(this.def));
      this.render();
    }

    /** Thumb position along the track, 0 = top/left, 1 = bottom/right. */
    _fraction() {
      const f = (this.value - this.min) / (this.max - this.min);
      if (this.vertical) return this.invert ? f : 1 - f;
      return f;
    }

    _setFraction(p) {
      p = U.clamp(p, 0, 1);
      const f = this.vertical ? (this.invert ? p : 1 - p) : p;
      this.set(this.min + f * (this.max - this.min));
    }

    _setFromPointer(e, rect) {
      const p = this.vertical ? (e.clientY - rect.top) / rect.height : (e.clientX - rect.left) / rect.width;
      this._setFraction(p);
    }

    set(v, emit) {
      v = U.clamp(v, this.min, this.max);
      this.value = v;
      this.render();
      if (emit !== false) this.onChange(v);
    }

    render() {
      const p = this._fraction() * 100;
      if (this.vertical) this.thumb.style.top = p + '%';
      else this.thumb.style.left = p + '%';
    }
  }

  root.DJ = root.DJ || {};
  root.DJ.Knob = Knob;
  root.DJ.Fader = Fader;
})(typeof window !== 'undefined' ? window : globalThis);
