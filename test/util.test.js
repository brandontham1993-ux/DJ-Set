'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/util.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`);

test('scale degrees wrap across octaves', () => {
  const minor = U.SCALES.minor;
  assert.equal(U.scaleNote(57, minor, 0), 57);
  assert.equal(U.scaleNote(57, minor, 7), 69);
  assert.equal(U.scaleNote(57, minor, -1), 55);
  assert.deepEqual(U.chordNotes(57, minor, 0, 3), [57, 60, 64]); // A C E
});

test('crossfader curves', () => {
  const c = U.crossfaderGains(0, 'smooth');
  near(c.a, Math.SQRT1_2, 1e-9);
  near(c.b, Math.SQRT1_2, 1e-9);
  assert.deepEqual(U.crossfaderGains(-1, 'smooth').a, 1);
  near(U.crossfaderGains(-1, 'smooth').b, 0, 1e-9);
  const s = U.crossfaderGains(0, 'sharp');
  assert.equal(s.a, 1);
  assert.equal(s.b, 1);
  assert.equal(U.crossfaderGains(1, 'sharp').a, 0);
});

test('EQ, trim and filter knob mapping', () => {
  assert.equal(U.eqKnobToDb(0), 0);
  assert.equal(U.eqKnobToDb(1), 6);
  assert.equal(U.eqKnobToDb(-1), -60);
  near(U.trimKnobToGain(0), 1, 1e-9);
  assert.deepEqual(U.filterKnobToFreqs(0), { lp: 22000, hp: 10 });
  near(U.filterKnobToFreqs(-1).lp, 60, 1e-6);
  near(U.filterKnobToFreqs(1).hp, 8000, 1e-6);
});

test('beat grid helpers', () => {
  const bpm = 120, first = 0.25; // beat = 0.5 s
  near(U.nearestBeat(0.9, bpm, first), 0.75, 1e-9);
  near(U.previousBeat(1.24, bpm, first), 0.75, 1e-9);
  near(U.previousBeat(1.25, bpm, first), 1.25, 1e-9);
  near(U.beatPhase(1.0, bpm, first), 0.5, 1e-9);
  near(U.phaseDelta(0.9, 0.1), 0.2, 1e-9);
  near(U.phaseDelta(0.1, 0.9), -0.2, 1e-9);
});

test('sync ratio handles half/double time', () => {
  near(U.syncRatio(124, 128).ratio, 128 / 124, 1e-9);
  const dnb = U.syncRatio(174, 88);
  assert.equal(dnb.mult, 2);
  near(dnb.ratio, 176 / 174, 1e-9);
});

test('camelot compatibility', () => {
  assert.ok(U.keysCompatible('8A', '8A'));
  assert.ok(U.keysCompatible('8A', '9A'));
  assert.ok(U.keysCompatible('12A', '1A'));
  assert.ok(U.keysCompatible('8A', '8B'));
  assert.ok(!U.keysCompatible('8A', '3A'));
});

function clickTrack(bpm, offset, seconds, sr) {
  const L = new Float32Array(Math.floor(seconds * sr));
  const rnd = U.mulberry32(1);
  for (let i = 0; i < L.length; i++) L[i] = (rnd() - 0.5) * 0.01;
  for (let t = offset; t < seconds; t += 60 / bpm) {
    const s = Math.floor(t * sr);
    for (let i = 0; i < 0.12 * sr && s + i < L.length; i++) {
      L[s + i] += Math.sin((2 * Math.PI * 60 * i) / sr) * Math.exp(-i / (0.04 * sr));
    }
  }
  return L;
}

test('bpm detection on synthetic kick track', () => {
  const sr = 22050;
  for (const bpm of [124, 128, 140, 95]) {
    const res = U.detectBpm(clickTrack(bpm, 0.3, 40, sr), sr);
    near(res.bpm, bpm, 0.15, `bpm ${bpm}`);
    const period = 60 / bpm;
    const phaseErr = Math.abs(U.phaseDelta(res.firstBeat / period, 0.3 / period)) * period;
    assert.ok(phaseErr < 0.03, `phase error ${phaseErr}s at ${bpm}`);
  }
});

test('peak analysis normalises to 1', () => {
  const sr = 8000;
  const L = new Float32Array(sr);
  for (let i = 0; i < L.length; i++) L[i] = Math.sin((2 * Math.PI * 100 * i) / sr) * 0.5;
  const p = U.analyzePeaks(L, null, sr, 100);
  assert.equal(p.bins, 100);
  let max = 0;
  for (let i = 0; i < p.bins; i++) max = Math.max(max, p.low[i], p.mid[i], p.high[i]);
  near(max, 1, 1e-6);
});
