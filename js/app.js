/*
 * App wiring: builds the deck/mixer/library UI, the keyboard map, the jog
 * wheels and the render loop.
 */
(function (root) {
  'use strict';

  const DJ = root.DJ;
  const U = DJ.util;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  const ACCENT = { A: '#38bdf8', B: '#fb923c' };
  const SEC_PER_REV = 1.8; // 33 1/3 RPM

  // ------------------------------------------------------------------ key map
  const DECK_KEYS = {
    A: {
      play: 'KeyF', cue: 'KeyD', sync: 'KeyS', fx: 'KeyA', pfl: 'KeyR',
      hot: ['Digit1', 'Digit2', 'Digit3', 'Digit4'],
      loopHalf: 'KeyQ', loop: 'KeyW', loopDouble: 'KeyE',
      pitchDown: 'KeyZ', pitchUp: 'KeyX', nudgeBack: 'KeyC', nudgeFwd: 'KeyV',
      volUp: 'KeyT', volDown: 'KeyG',
    },
    B: {
      play: 'KeyJ', cue: 'KeyK', sync: 'KeyL', fx: 'Semicolon', pfl: 'KeyP',
      hot: ['Digit7', 'Digit8', 'Digit9', 'Digit0'],
      loopHalf: 'KeyU', loop: 'KeyI', loopDouble: 'KeyO',
      pitchDown: 'KeyN', pitchUp: 'KeyM', nudgeBack: 'Comma', nudgeFwd: 'Period',
      volUp: 'KeyY', volDown: 'KeyH',
    },
  };

  const keyLabel = (code) => {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return { Comma: ',', Period: '.', Semicolon: ';', BracketLeft: '[', BracketRight: ']', Backquote: '`', Slash: '/', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }[code] || code;
  };
  const kbd = (code) => `<kbd>${keyLabel(code)}</kbd>`;

  // ------------------------------------------------------------------ state
  const app = {
    engine: null,
    decks: null,
    ui: { A: {}, B: {} },
    library: [],
    selected: 0,
    loading: { A: 0, B: 0 },
  };
  root.DJ.app = app; // handy for debugging from the console

  // ------------------------------------------------------------------ toasts
  let toastTimer = null;
  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 2600);
  }

  // ------------------------------------------------------------------ markup
  function deckMarkup(id) {
    const k = DECK_KEYS[id];
    return `
      <div class="deck-head">
        <div class="deck-letter">${id}</div>
        <div class="track-info">
          <div class="track-title">Empty deck</div>
          <div class="track-sub">Load a track from the library below</div>
        </div>
        <div class="deck-tempo">
          <div class="bpm-val">--.-</div>
          <div class="bpm-sub"><span class="pitch-val">0.00%</span> · <span class="key-val">--</span></div>
        </div>
      </div>
      <canvas class="overview" title="Click or drag to jump around the track"></canvas>
      <div class="time-row">
        <span class="elapsed">0:00.0</span>
        <span class="beat-dots"><i></i><i></i><i></i><i></i></span>
        <span class="remain">-0:00.0</span>
      </div>
      <div class="deck-body">
        <div class="jog-col">
          <div class="jog" title="Vinyl mode: grab to scratch. Otherwise drag to bend the tempo (nudge). Scroll to nudge.">
            <div class="platter">
              <div class="platter-grooves"></div>
              <div class="platter-marker"></div>
              <div class="platter-label">${id}</div>
            </div>
          </div>
          <div class="transport">
            <button class="btn cue" data-act="cue" title="Cue: set / return / hold to preview">CUE ${kbd(k.cue)}</button>
            <button class="btn play" data-act="play" title="Play / pause"><span class="play-icon">▶</span> ${kbd(k.play)}</button>
            <button class="btn sync" data-act="sync" title="Match tempo and beat to the other deck">SYNC ${kbd(k.sync)}</button>
          </div>
        </div>
        <div class="pitch-col">
          <button class="mini range" data-act="range" title="Pitch range">±8%</button>
          <span class="pitch-label">−</span>
          <div class="pitch-fader"></div>
          <span class="pitch-label">+</span>
          <button class="mini" data-act="pitch-reset" title="Reset tempo to 0%">0%</button>
          <div class="pitch-keys">${kbd(k.pitchDown)}${kbd(k.pitchUp)}</div>
        </div>
      </div>
      <div class="section-label">Hot cues <small>Shift / right-click = delete</small></div>
      <div class="pads">
        ${k.hot.map((code, i) => `<button class="pad" data-hot="${i}"><span>${i + 1}</span>${kbd(code)}</button>`).join('')}
      </div>
      <div class="section-label">Loop &amp; nudge</div>
      <div class="loop-row">
        <button class="btn small" data-act="loop-half" title="Halve loop">½ ${kbd(k.loopHalf)}</button>
        <button class="btn small loop-btn" data-act="loop" title="Loop on/off">LOOP <b class="loop-size">4</b> ${kbd(k.loop)}</button>
        <button class="btn small" data-act="loop-double" title="Double loop">×2 ${kbd(k.loopDouble)}</button>
        <button class="btn small" data-act="nudge-back" title="Hold to slow down a little">◀◀ ${kbd(k.nudgeBack)}</button>
        <button class="btn small" data-act="nudge-fwd" title="Hold to speed up a little">▶▶ ${kbd(k.nudgeFwd)}</button>
      </div>
      <div class="option-row">
        <button class="toggle on" data-act="quantize" title="Snap cues and loops to the beat grid">QUANTIZE</button>
        <button class="toggle on" data-act="vinyl" title="Vinyl mode: the jog wheel scratches">VINYL</button>
      </div>
      <div class="section-label">Effect</div>
      <div class="fx-row">
        <select class="fx-type" title="Effect type">
          <option value="echo">Echo</option>
          <option value="reverb">Reverb</option>
          <option value="flanger">Flanger</option>
        </select>
        <select class="fx-beats" title="Echo time in beats">
          <option value="0.25">1/4 beat</option>
          <option value="0.5" selected>1/2 beat</option>
          <option value="0.75">3/4 beat</option>
          <option value="1">1 beat</option>
          <option value="2">2 beats</option>
        </select>
        <div class="fx-amount"></div>
        <button class="toggle fx-on" data-act="fx">FX ${kbd(k.fx)}</button>
      </div>`;
  }

  function channelMarkup(id) {
    const k = DECK_KEYS[id];
    return `
      <div class="channel" data-deck="${id}">
        <div class="ch-title" style="color:${ACCENT[id]}">${id}</div>
        <div class="knob-slot trim"></div>
        <div class="eq-row"><div class="knob-slot eq-high"></div><button class="kill" data-band="high" title="Kill highs (Shift+${keyLabel(k.loopDouble)})">K</button></div>
        <div class="eq-row"><div class="knob-slot eq-mid"></div><button class="kill" data-band="mid" title="Kill mids (Shift+${keyLabel(k.loop)})">K</button></div>
        <div class="eq-row"><div class="knob-slot eq-low"></div><button class="kill" data-band="low" title="Kill bass (Shift+${keyLabel(k.loopHalf)})">K</button></div>
        <div class="knob-slot filter"></div>
        <button class="toggle pfl" title="Headphone cue (needs Split Cue on)">🎧 ${kbd(k.pfl)}</button>
        <div class="fader-wrap">
          <div class="meter"><div class="meter-fill"></div></div>
          <div class="volume-fader"></div>
        </div>
        <div class="vol-keys">${kbd(k.volUp)}${kbd(k.volDown)}</div>
      </div>`;
  }

  function buildUI() {
    for (const id of ['A', 'B']) {
      const el = $('#deck-' + id);
      el.innerHTML = deckMarkup(id);
      el.style.setProperty('--accent', ACCENT[id]);
    }
    $('#mixer').innerHTML = `
      <div class="mixer-channels">${channelMarkup('A')}${channelMarkup('B')}</div>
      <div class="xfader-block">
        <div class="xfader-labels"><span style="color:${ACCENT.A}">A</span><span>CROSSFADER <kbd>←</kbd><kbd>B</kbd><kbd>→</kbd></span><span style="color:${ACCENT.B}">B</span></div>
        <div class="crossfader"></div>
        <button class="mini xf-curve" title="Crossfader curve">Curve: Smooth</button>
      </div>`;

    for (const id of ['A', 'B']) buildDeckUI(id);
    buildMixerUI();
  }

  function buildDeckUI(id) {
    const deck = app.decks[id];
    const el = $('#deck-' + id);
    const ui = app.ui[id];
    ui.root = el;
    ui.title = $('.track-title', el);
    ui.sub = $('.track-sub', el);
    ui.bpm = $('.bpm-val', el);
    ui.pitch = $('.pitch-val', el);
    ui.key = $('.key-val', el);
    ui.elapsed = $('.elapsed', el);
    ui.remain = $('.remain', el);
    ui.dots = $$('.beat-dots i', el);
    ui.platter = $('.platter', el);
    ui.playBtn = $('[data-act=play]', el);
    ui.cueBtn = $('[data-act=cue]', el);
    ui.loopBtn = $('[data-act=loop]', el);
    ui.loopSize = $('.loop-size', el);
    ui.range = $('[data-act=range]', el);
    ui.pads = $$('.pad', el);
    ui.fxOn = $('.fx-on', el);
    ui.fxType = $('.fx-type', el);
    ui.fxBeats = $('.fx-beats', el);

    ui.overview = new DJ.Overview($('.overview', el), deck, ACCENT[id]);
    ui.wave = new DJ.MainWaveform($('#wave-' + id), deck, ACCENT[id]);

    ui.pitchFader = new DJ.Fader($('.pitch-fader', el), {
      min: -1, max: 1, value: 0, invert: true, centerMark: true, title: 'Tempo (pitch)',
      onChange: (v) => deck.setPitch(v),
    });
    ui.fxKnob = new DJ.Knob($('.fx-amount', el), {
      min: 0, max: 1, value: 0.5, label: 'AMOUNT', onChange: (v) => deck.setFxAmount(v),
    });

    // transport buttons
    const hold = (btn, down, up) => {
      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        down();
        const release = () => {
          up();
          root.removeEventListener('pointerup', release);
        };
        root.addEventListener('pointerup', release);
      });
    };
    hold(ui.cueBtn, () => deck.cueDown(), () => deck.cueUp());
    hold($('[data-act=nudge-back]', el), () => deck.setBend(-0.04), () => deck.setBend(0));
    hold($('[data-act=nudge-fwd]', el), () => deck.setBend(0.04), () => deck.setBend(0));
    ui.playBtn.addEventListener('click', () => deck.togglePlay());
    $('[data-act=sync]', el).addEventListener('click', () => actions.sync(id));
    $('[data-act=loop]', el).addEventListener('click', () => deck.loopToggle());
    $('[data-act=loop-half]', el).addEventListener('click', () => deck.loopResize(0.5));
    $('[data-act=loop-double]', el).addEventListener('click', () => deck.loopResize(2));
    ui.range.addEventListener('click', () => deck.cyclePitchRange());
    $('[data-act=pitch-reset]', el).addEventListener('click', () => deck.resetPitch());
    const quant = $('[data-act=quantize]', el);
    quant.addEventListener('click', () => {
      deck.quantize = !deck.quantize;
      quant.classList.toggle('on', deck.quantize);
    });
    const vinyl = $('[data-act=vinyl]', el);
    vinyl.addEventListener('click', () => {
      deck.vinyl = !deck.vinyl;
      vinyl.classList.toggle('on', deck.vinyl);
    });

    ui.pads.forEach((pad, i) => {
      pad.addEventListener('pointerdown', (e) => {
        if (e.button === 2 || e.shiftKey) deck.deleteHotCue(i);
        else if (e.button === 0) deck.hotCue(i);
      });
      pad.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    ui.fxOn.addEventListener('click', () => deck.toggleFx());
    ui.fxType.addEventListener('change', () => deck.setFxType(ui.fxType.value));
    ui.fxBeats.addEventListener('change', () => deck.setFxBeats(parseFloat(ui.fxBeats.value)));

    setupJog(id);

    deck.on((what) => {
      if (what === 'load') renderTrackInfo(id);
      if (what === 'tempo' || what === 'load') renderTempo(id);
      if (what === 'loop' || what === 'load') {
        ui.loopBtn.classList.toggle('on', deck.loop.on);
        const b = deck.loop.beats;
        ui.loopSize.textContent = b >= 1 ? String(b) : '1/' + Math.round(1 / b);
      }
      if (what === 'cues' || what === 'load') {
        ui.pads.forEach((pad, i) => {
          const set = deck.hotCues[i] != null;
          pad.classList.toggle('set', set);
          pad.style.setProperty('--pad', set ? DJ.HOT_COLORS[i] : '');
        });
      }
      if (what === 'fx') {
        ui.fxOn.classList.toggle('on', deck.fxOn);
        ui.fxBeats.disabled = deck.fxType !== 'echo';
      }
      if (what === 'eq') {
        $$(`.channel[data-deck=${id}] .kill`).forEach((b) => b.classList.toggle('on', deck.kills[b.dataset.band]));
      }
      if (what === 'pfl') $(`.channel[data-deck=${id}] .pfl`).classList.toggle('on', deck.pflOn);
      if (what === 'volume') app.ui[id].volFader && app.ui[id].volFader.set(deck.volume, false);
      if (what === 'load') renderLibrary();
    });
  }

  function buildMixerUI() {
    const eng = app.engine;
    for (const id of ['A', 'B']) {
      const deck = app.decks[id];
      const ch = $(`.channel[data-deck=${id}]`);
      const ui = app.ui[id];
      ui.trim = new DJ.Knob($('.trim', ch), { label: 'TRIM', onChange: (v) => deck.setTrim(v) });
      ui.eq = {
        high: new DJ.Knob($('.eq-high', ch), { label: 'HI', className: 'eq', onChange: (v) => deck.setEq('high', v) }),
        mid: new DJ.Knob($('.eq-mid', ch), { label: 'MID', className: 'eq', onChange: (v) => deck.setEq('mid', v) }),
        low: new DJ.Knob($('.eq-low', ch), { label: 'LOW', className: 'eq', onChange: (v) => deck.setEq('low', v) }),
      };
      ui.filter = new DJ.Knob($('.filter', ch), {
        label: 'FILTER', className: 'filter-knob', title: 'Filter: left = low-pass, right = high-pass',
        onChange: (v) => deck.setFilter(v),
      });
      ui.volFader = new DJ.Fader($('.volume-fader', ch), {
        min: 0, max: 1, value: deck.volume, title: 'Channel volume', onChange: (v) => deck.setVolume(v),
      });
      ui.meter = $('.meter-fill', ch);
      $$('.kill', ch).forEach((b) => b.addEventListener('click', () => deck.toggleKill(b.dataset.band)));
      $('.pfl', ch).addEventListener('click', () => actions.pfl(id));
    }
    app.xfader = new DJ.Fader($('.crossfader'), {
      orientation: 'horizontal', min: -1, max: 1, value: 0, centerMark: true, title: 'Crossfader',
      onChange: (v) => eng.setCrossfader(v),
    });
    const curveBtn = $('.xf-curve');
    curveBtn.addEventListener('click', () => {
      eng.setCrossfaderCurve(eng.xfCurve === 'smooth' ? 'sharp' : 'smooth');
      curveBtn.textContent = 'Curve: ' + (eng.xfCurve === 'smooth' ? 'Smooth' : 'Sharp (scratch)');
    });
    app.masterKnob = new DJ.Knob($('#master-knob'), {
      min: 0, max: 1, value: 0.8, label: 'MASTER', onChange: (v) => eng.setMasterVolume(v),
    });
  }

  // ------------------------------------------------------------------ jog wheel
  function setupJog(id) {
    const deck = app.decks[id];
    const jog = $('.jog', app.ui[id].root);
    let bendTimer = null;

    const angleOf = (e) => {
      const r = jog.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };

    jog.addEventListener('pointerdown', (e) => {
      if (!deck.loaded || e.button !== 0) return;
      e.preventDefault();
      jog.setPointerCapture(e.pointerId);
      const scratch = deck.vinyl || !deck.playing;
      let last = angleOf(e);
      let lastT = performance.now();
      if (scratch) deck.scratchStart();
      jog.classList.add('touched');
      const move = (ev) => {
        const a = angleOf(ev);
        let d = a - last;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        last = a;
        const now = performance.now();
        const dt = Math.max(1, now - lastT) / 1000;
        lastT = now;
        if (scratch) {
          deck.scratchMove((d / (2 * Math.PI)) * SEC_PER_REV);
        } else {
          deck.setBend(U.clamp((d / dt) * 0.02, -0.5, 0.5));
          clearTimeout(bendTimer);
          bendTimer = setTimeout(() => deck.setBend(0), 70);
        }
      };
      const up = () => {
        jog.classList.remove('touched');
        if (scratch) deck.scratchEnd();
        else deck.setBend(0);
        jog.removeEventListener('pointermove', move);
        jog.removeEventListener('pointerup', up);
        jog.removeEventListener('pointercancel', up);
      };
      jog.addEventListener('pointermove', move);
      jog.addEventListener('pointerup', up);
      jog.addEventListener('pointercancel', up);
    });

    jog.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!deck.loaded) return;
      const dir = Math.sign(e.deltaY);
      if (deck.playing) {
        deck.setBend(-dir * 0.06);
        clearTimeout(bendTimer);
        bendTimer = setTimeout(() => deck.setBend(0), 120);
      } else {
        deck.seek(deck.position - dir * 0.02);
      }
    }, { passive: false });
  }

  // ------------------------------------------------------------------ rendering
  function renderTrackInfo(id) {
    const deck = app.decks[id];
    const ui = app.ui[id];
    const t = deck.track;
    ui.title.textContent = t ? t.title : 'Empty deck';
    ui.sub.textContent = t ? `${t.artist}${t.genre ? ' · ' + t.genre : ''}` : 'Load a track from the library below';
    ui.key.textContent = t && t.camelot ? `${t.camelot} ${t.key}` : t && t.key ? t.key : '--';
  }

  function renderTempo(id) {
    const deck = app.decks[id];
    const ui = app.ui[id];
    ui.bpm.textContent = deck.bpm ? deck.currentBpm.toFixed(1) : '--.-';
    const pct = (deck.tempoRatio - 1) * 100;
    ui.pitch.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    ui.range.textContent = '±' + Math.round(deck.pitchRange * 100) + '%';
    ui.pitchFader.set(deck.pitch, false);
  }

  const meterHold = { A: 0, B: 0, L: 0, R: 0 };
  function meterHeight(key, level) {
    const db = 20 * Math.log10(level + 1e-6);
    const v = U.clamp((db + 48) / 48, 0, 1);
    meterHold[key] = Math.max(v, meterHold[key] - 0.025);
    return meterHold[key];
  }

  function frame() {
    for (const id of ['A', 'B']) {
      const deck = app.decks[id];
      const ui = app.ui[id];
      ui.wave.draw();
      ui.overview.draw();
      const pos = deck.position;
      ui.platter.style.transform = `rotate(${((pos / SEC_PER_REV) * 360) % 360}deg)`;
      if (deck.loaded) {
        ui.elapsed.textContent = U.formatTime(pos);
        const rem = (deck.length - pos) / deck.tempoRatio;
        ui.remain.textContent = '-' + U.formatTime(rem);
        ui.remain.classList.toggle('warn', deck.playing && rem < 30);
        const beat = Math.floor(U.beatAt(pos, deck.bpm, deck.firstBeat) + 1e-4);
        const inBar = ((beat % 4) + 4) % 4;
        ui.dots.forEach((d, i) => d.classList.toggle('on', i === inBar && pos >= deck.firstBeat - 0.01));
      }
      ui.playBtn.classList.toggle('on', deck.playing);
      $('.play-icon', ui.playBtn).textContent = deck.playing ? '❚❚' : '▶';
      ui.cueBtn.classList.toggle('blink', deck.loaded && !deck.playing && Math.abs(pos - deck.cuePoint) > 0.02);
      const h = meterHeight(id, deck.level());
      ui.meter.style.transform = `scaleY(${h})`;
      ui.meter.classList.toggle('hot', h > 0.94);
    }
    const [l, r] = app.engine.masterLevels();
    $('#master-meter .l').style.transform = `scaleX(${meterHeight('L', l)})`;
    $('#master-meter .r').style.transform = `scaleX(${meterHeight('R', r)})`;
    if (app.engine.recording) {
      $('#rec-time').textContent = U.formatTime((performance.now() - app.engine.recStart) / 1000).slice(0, -2);
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ actions
  const actions = {
    sync(id) {
      const deck = app.decks[id];
      const other = app.decks[id === 'A' ? 'B' : 'A'];
      if (!deck.sync(other)) toast('Load tracks on both decks to use SYNC');
    },
    pfl(id) {
      const deck = app.decks[id];
      deck.setPfl(!deck.pflOn);
      if (deck.pflOn && !app.engine.splitCue) toast('Turn on "Split Cue" (top bar) and wear headphones to hear the cue channel in your left ear', 4000);
    },
    volume(id, delta) {
      const deck = app.decks[id];
      deck.setVolume(deck.volume + delta);
    },
    filter(id, delta) {
      const k = app.ui[id].filter;
      k.set(k.value + delta);
    },
    crossfader(delta) {
      app.xfader.set(app.xfader.value + delta);
    },
  };

  // ------------------------------------------------------------------ keyboard
  function setupKeyboard() {
    const held = new Set();
    const byCode = {};
    for (const id of ['A', 'B']) {
      const k = DECK_KEYS[id];
      for (const [act, code] of Object.entries(k)) {
        if (Array.isArray(code)) code.forEach((c, i) => (byCode[c] = { id, act: 'hot', i }));
        else byCode[code] = { id, act };
      }
    }

    root.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (tag === 'SELECT' && e.code.startsWith('Arrow')) return;
      const help = $('#help-overlay');
      if (e.code === 'Escape') {
        help.hidden = true;
        return;
      }
      if (e.code === 'Backquote' || (e.code === 'Slash' && e.shiftKey)) {
        help.hidden = !help.hidden;
        e.preventDefault();
        return;
      }
      const rep = e.repeat;

      // global controls
      switch (e.code) {
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) app.xfader.set(-1);
          else actions.crossfader(-0.05);
          return;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) app.xfader.set(1);
          else actions.crossfader(0.05);
          return;
        case 'KeyB':
          if (!rep) app.xfader.set(0);
          return;
        case 'ArrowUp':
        case 'ArrowDown':
          e.preventDefault();
          selectTrack(app.selected + (e.code === 'ArrowUp' ? -1 : 1));
          return;
        case 'BracketLeft':
          if (!rep) loadToDeck(app.library[app.selected], 'A');
          return;
        case 'BracketRight':
          if (!rep) loadToDeck(app.library[app.selected], 'B');
          return;
        case 'Space':
          e.preventDefault(); // keep the page from scrolling
          return;
      }

      const m = byCode[e.code];
      if (!m) return;
      e.preventDefault();
      const deck = app.decks[m.id];
      const sh = e.shiftKey;
      held.add(e.code);

      switch (m.act) {
        case 'play': if (!rep) deck.togglePlay(); break;
        case 'cue': if (!rep) deck.cueDown(); break;
        case 'sync': if (!rep) actions.sync(m.id); break;
        case 'fx': if (!rep) deck.toggleFx(); break;
        case 'pfl': if (!rep) actions.pfl(m.id); break;
        case 'hot':
          if (!rep) sh ? deck.deleteHotCue(m.i) : deck.hotCue(m.i);
          break;
        case 'loopHalf': if (!rep) sh ? deck.toggleKill('low') : deck.loopResize(0.5); break;
        case 'loop': if (!rep) sh ? deck.toggleKill('mid') : deck.loopToggle(); break;
        case 'loopDouble': if (!rep) sh ? deck.toggleKill('high') : deck.loopResize(2); break;
        case 'pitchDown': sh ? actions.filter(m.id, -0.05) : deck.nudgeTempo(-0.05); break;
        case 'pitchUp': sh ? actions.filter(m.id, 0.05) : deck.nudgeTempo(0.05); break;
        case 'nudgeBack':
          if (rep) break;
          if (sh) deck.seek(deck.position - 4 * U.beatLength(deck.bpm || 120));
          else deck.setBend(-0.04);
          break;
        case 'nudgeFwd':
          if (rep) break;
          if (sh) deck.seek(deck.position + 4 * U.beatLength(deck.bpm || 120));
          else deck.setBend(0.04);
          break;
        case 'volUp': actions.volume(m.id, 0.05); break;
        case 'volDown': actions.volume(m.id, -0.05); break;
      }
      if (m.act === 'cue' || m.act === 'nudgeBack' || m.act === 'nudgeFwd') {
        flash(m.id, m.act);
      }
    });

    root.addEventListener('keyup', (e) => {
      held.delete(e.code);
      const m = byCode[e.code];
      if (!m) return;
      const deck = app.decks[m.id];
      if (m.act === 'cue') deck.cueUp();
      if (m.act === 'nudgeBack' || m.act === 'nudgeFwd') deck.setBend(0);
      unflash(m.id, m.act);
    });

    // releasing everything if the window loses focus avoids stuck nudges/cue previews
    root.addEventListener('blur', () => {
      for (const id of ['A', 'B']) {
        app.decks[id].setBend(0);
        app.decks[id].cueUp();
      }
      held.clear();
    });
  }

  function flash(id, act) {
    const sel = { cue: '[data-act=cue]', nudgeBack: '[data-act=nudge-back]', nudgeFwd: '[data-act=nudge-fwd]' }[act];
    if (sel) $(sel, app.ui[id].root).classList.add('pressed');
  }
  function unflash(id, act) {
    const sel = { cue: '[data-act=cue]', nudgeBack: '[data-act=nudge-back]', nudgeFwd: '[data-act=nudge-fwd]' }[act];
    if (sel) $(sel, app.ui[id].root).classList.remove('pressed');
  }

  // ------------------------------------------------------------------ library
  let uid = 0;
  function initLibrary() {
    app.library = DJ.Synth.TRACKS.map((t) => ({
      uid: 'gen-' + t.id,
      title: t.title,
      artist: t.artist,
      genre: t.genre,
      bpm: t.bpm,
      key: t.key,
      camelot: t.camelot,
      duration: t.duration,
      def: t,
      generated: true,
    }));
    renderLibrary();

    const input = $('#file-input');
    $('#btn-add').addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      addFiles(input.files);
      input.value = '';
    });

    const drop = $('#drop-zone');
    let depth = 0;
    root.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
      depth++;
      drop.classList.add('show');
    });
    root.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) drop.classList.remove('show');
    });
    root.addEventListener('dragover', (e) => e.preventDefault());
    root.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      drop.classList.remove('show');
      if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });
  }

  function addFiles(files) {
    let added = 0;
    for (const f of files) {
      if (!/^audio\//.test(f.type) && !/\.(mp3|wav|ogg|oga|flac|m4a|aac|webm|opus)$/i.test(f.name)) continue;
      const name = f.name.replace(/\.[^.]+$/, '');
      const dash = name.indexOf(' - ');
      app.library.push({
        uid: 'file-' + ++uid,
        title: dash > 0 ? name.slice(dash + 3) : name,
        artist: dash > 0 ? name.slice(0, dash) : 'Your file',
        genre: 'Imported',
        bpm: null,
        key: null,
        camelot: null,
        duration: null,
        file: f,
      });
      added++;
    }
    renderLibrary();
    toast(added ? `Added ${added} track${added > 1 ? 's' : ''} to the library` : 'No audio files found in that drop');
  }

  function selectTrack(i) {
    app.selected = U.clamp(i, 0, app.library.length - 1);
    renderLibrary();
    const row = $(`#library-body tr[data-i="${app.selected}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  function renderLibrary() {
    const body = $('#library-body');
    if (!body) return;
    const a = app.decks && app.decks.A, b = app.decks && app.decks.B;
    // compatibility hints relative to whatever is playing (or loaded)
    const ref = [a, b].find((d) => d && d.playing) || [a, b].find((d) => d && d.loaded);
    body.innerHTML = app.library.map((t, i) => {
      const onA = a && a.track && a.track.uid === t.uid;
      const onB = b && b.track && b.track.uid === t.uid;
      let bpmHint = '', keyHint = '';
      if (ref && ref.loaded && t.bpm && ref.track.uid !== t.uid) {
        const r = U.syncRatio(t.bpm, ref.currentBpm).ratio;
        if (Math.abs(r - 1) <= 0.06) bpmHint = 'good';
        if (t.camelot && ref.track.camelot && U.keysCompatible(t.camelot, ref.track.camelot)) keyHint = 'good';
      }
      return `<tr data-i="${i}" class="${i === app.selected ? 'selected' : ''}">
        <td class="num">${i + 1}</td>
        <td class="title">${escapeHtml(t.title)}${onA ? ' <span class="on-deck a">A</span>' : ''}${onB ? ' <span class="on-deck b">B</span>' : ''}</td>
        <td class="artist">${escapeHtml(t.artist)}</td>
        <td>${escapeHtml(t.genre || '')}</td>
        <td class="bpm ${bpmHint}">${t.bpm ? t.bpm.toFixed(t.bpm % 1 ? 1 : 0) : '?'}</td>
        <td class="key ${keyHint}">${t.camelot ? t.camelot : t.key || '?'}</td>
        <td>${t.duration ? U.formatTime(t.duration).slice(0, -2) : '--'}</td>
        <td class="load"><button data-load="A" data-i="${i}">A</button><button data-load="B" data-i="${i}">B</button></td>
      </tr>`;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function loadToDeck(item, id, force) {
    if (!item) return;
    const deck = app.decks[id];
    if (deck.playing && !force) {
      toast(`Deck ${id} is playing — pause it first (or you'd cut the music!)`);
      return;
    }
    const token = ++app.loading[id];
    const ui = app.ui[id];
    ui.root.classList.add('loading');
    ui.title.textContent = item.title;
    ui.sub.textContent = item.generated ? 'Composing track…' : 'Decoding…';
    try {
      let L, R, sampleRate, bpm, firstBeat;
      if (item.generated) {
        const res = await DJ.Synth.generate(item.def, (p) => {
          if (token === app.loading[id]) ui.sub.textContent = `Composing track… ${Math.round(p * 100)}%`;
        });
        ({ L, R, sampleRate, bpm, firstBeat } = res);
      } else {
        const data = await item.file.arrayBuffer();
        const buf = await app.engine.ctx.decodeAudioData(data);
        sampleRate = buf.sampleRate;
        L = new Float32Array(buf.getChannelData(0));
        R = buf.numberOfChannels > 1 ? new Float32Array(buf.getChannelData(1)) : null;
        if (item.bpm == null) {
          ui.sub.textContent = 'Detecting BPM…';
          await new Promise((r) => setTimeout(r, 20));
          let mono = L;
          if (R) {
            mono = new Float32Array(L.length);
            for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) * 0.5;
          }
          const det = U.detectBpm(mono, sampleRate) || { bpm: 120, firstBeat: 0 };
          item.bpm = det.bpm;
          item.firstBeat = det.firstBeat;
        }
        item.duration = L.length / sampleRate;
        bpm = item.bpm;
        firstBeat = item.firstBeat;
      }
      if (token !== app.loading[id]) return; // a newer load replaced this one
      if (!item.peaks) item.peaks = U.analyzePeaks(L, R, sampleRate, 150);
      deck.load({
        uid: item.uid,
        title: item.title,
        artist: item.artist,
        genre: item.genre,
        bpm,
        firstBeat,
        key: item.key,
        camelot: item.camelot,
        peaks: item.peaks,
      }, L, R, sampleRate);
    } catch (err) {
      console.error(err);
      toast(`Could not load "${item.title}": ${err.message || err}`, 4000);
      renderTrackInfo(id);
    } finally {
      if (token === app.loading[id]) ui.root.classList.remove('loading');
    }
  }

  // ------------------------------------------------------------------ top bar
  function setupTopBar() {
    const split = $('#btn-split');
    split.addEventListener('click', () => {
      app.engine.setSplitCue(!app.engine.splitCue);
      split.classList.toggle('on', app.engine.splitCue);
      toast(app.engine.splitCue
        ? 'Split Cue ON — headphones: LEFT ear = cue (🎧 channels), RIGHT ear = master'
        : 'Split Cue OFF — normal stereo output', 4000);
    });

    const rec = $('#btn-record');
    rec.addEventListener('click', async () => {
      const eng = app.engine;
      if (!eng.recording) {
        try {
          eng.startRecording();
          rec.classList.add('on');
          toast('Recording your mix…');
        } catch (err) {
          toast('Recording is not supported in this browser');
        }
        return;
      }
      rec.classList.remove('on');
      const blob = await eng.stopRecording();
      $('#rec-time').textContent = '';
      if (!blob || !blob.size) return toast('Nothing was recorded');
      const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      a.download = `my-mix-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('Mix saved to your downloads');
    });

    $('#btn-help').addEventListener('click', () => ($('#help-overlay').hidden = false));
    $('#help-close').addEventListener('click', () => ($('#help-overlay').hidden = true));
    $('#help-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'help-overlay') e.target.hidden = true;
    });

    $('#library-body').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-load]');
      if (btn) {
        loadToDeck(app.library[+btn.dataset.i], btn.dataset.load);
        return;
      }
      const row = e.target.closest('tr');
      if (row) selectTrack(+row.dataset.i);
    });
    $('#library-body').addEventListener('dblclick', (e) => {
      const row = e.target.closest('tr');
      if (!row || e.target.closest('button')) return;
      const target = !app.decks.A.playing ? 'A' : !app.decks.B.playing ? 'B' : null;
      if (target) loadToDeck(app.library[+row.dataset.i], target);
      else toast('Both decks are playing — pause one first');
    });
  }

  function buildHelp() {
    const A = DECK_KEYS.A, B = DECK_KEYS.B;
    const row = (label, a, b) => `<tr><td>${label}</td><td>${a}</td><td>${b}</td></tr>`;
    const keys = (arr) => arr.map(kbd).join(' ');
    $('#help-keys').innerHTML = `
      <table class="keytable">
        <thead><tr><th>Action</th><th style="color:${ACCENT.A}">Deck A</th><th style="color:${ACCENT.B}">Deck B</th></tr></thead>
        <tbody>
          ${row('Play / pause', kbd(A.play), kbd(B.play))}
          ${row('Cue (hold to preview)', kbd(A.cue), kbd(B.cue))}
          ${row('Sync tempo + beat', kbd(A.sync), kbd(B.sync))}
          ${row('Hot cues 1–4', keys(A.hot), keys(B.hot))}
          ${row('Delete hot cue', 'Shift + ' + keys(A.hot.slice(0, 1)) + '…', 'Shift + ' + keys(B.hot.slice(0, 1)) + '…')}
          ${row('Loop ½ / on-off / ×2', keys([A.loopHalf, A.loop, A.loopDouble]), keys([B.loopHalf, B.loop, B.loopDouble]))}
          ${row('Kill low / mid / high', 'Shift + ' + keys([A.loopHalf, A.loop, A.loopDouble]), 'Shift + ' + keys([B.loopHalf, B.loop, B.loopDouble]))}
          ${row('Tempo − / + (hold)', keys([A.pitchDown, A.pitchUp]), keys([B.pitchDown, B.pitchUp]))}
          ${row('Filter sweep ◀ / ▶', 'Shift + ' + keys([A.pitchDown, A.pitchUp]), 'Shift + ' + keys([B.pitchDown, B.pitchUp]))}
          ${row('Nudge slower / faster (hold)', keys([A.nudgeBack, A.nudgeFwd]), keys([B.nudgeBack, B.nudgeFwd]))}
          ${row('Beat jump −4 / +4', 'Shift + ' + keys([A.nudgeBack, A.nudgeFwd]), 'Shift + ' + keys([B.nudgeBack, B.nudgeFwd]))}
          ${row('Volume up / down', keys([A.volUp, A.volDown]), keys([B.volUp, B.volDown]))}
          ${row('Effect on / off', kbd(A.fx), kbd(B.fx))}
          ${row('Headphone cue', kbd(A.pfl), kbd(B.pfl))}
        </tbody>
      </table>
      <table class="keytable global">
        <tbody>
          <tr><td>Crossfader left / right</td><td><kbd>←</kbd> <kbd>→</kbd> (Shift = slam to side)</td></tr>
          <tr><td>Crossfader centre</td><td><kbd>B</kbd></td></tr>
          <tr><td>Browse library</td><td><kbd>↑</kbd> <kbd>↓</kbd></td></tr>
          <tr><td>Load selected track to A / B</td><td><kbd>[</kbd> <kbd>]</kbd></td></tr>
          <tr><td>Show / hide this help</td><td><kbd>?</kbd> or <kbd>\`</kbd>, <kbd>Esc</kbd> closes</td></tr>
        </tbody>
      </table>`;
  }

  // ------------------------------------------------------------------ boot
  async function start() {
    const btn = $('#start-btn');
    btn.disabled = true;
    btn.textContent = 'Starting audio…';
    try {
      app.engine = new DJ.AudioEngine();
      await app.engine.init();
    } catch (err) {
      console.error(err);
      btn.textContent = 'Audio failed to start';
      $('#start-error').textContent = 'Your browser blocked or does not support the Web Audio features this app needs (AudioWorklet). Try a recent Chrome, Edge, Firefox or Safari. ' + (err.message || '');
      return;
    }
    app.decks = app.engine.decks;
    buildUI();
    setupKeyboard();
    setupTopBar();
    buildHelp();
    initLibrary();
    $('#start-overlay').hidden = true;
    requestAnimationFrame(frame);

    // Ready-to-mix starting point: two compatible tracks loaded.
    const first = app.library.findIndex((t) => t.uid === 'gen-neon-arcade');
    const second = app.library.findIndex((t) => t.uid === 'gen-pulse-theory');
    await Promise.all([loadToDeck(app.library[first], 'A'), loadToDeck(app.library[second], 'B')]);
    toast('Ready! Press F to start deck A — press ? for all keys', 4000);
  }

  root.addEventListener('DOMContentLoaded', () => {
    $('#start-btn').addEventListener('click', start);
  });
})(typeof window !== 'undefined' ? window : globalThis);
