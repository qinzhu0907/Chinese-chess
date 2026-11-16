/* 音效：全部用 WebAudio 现场合成，不依赖任何音频文件 */
(function (root) {
  'use strict';

  var Ctx = root.AudioContext || root.webkitAudioContext;
  var ctx = null;
  var enabled = true;

  function ensure() {
    if (!Ctx) return null;
    if (!ctx) {
      try { ctx = new Ctx(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return ctx;
  }

  /* 木质敲击：噪声过带通 + 低频撞击 */
  function knock(gain, freq, dur) {
    var c = ensure();
    if (!c || !enabled) return;
    var now = c.currentTime;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      var k = 1 - i / len;
      data[i] = (Math.random() * 2 - 1) * k * k;
    }
    var src = c.createBufferSource();
    src.buffer = buf;
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.2;
    var g = c.createGain();
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(bp); bp.connect(g); g.connect(c.destination);
    src.start(now);

    var osc = c.createOscillator();
    var og = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 0.16, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.09, now + dur);
    og.gain.value = gain * 0.9;
    og.gain.exponentialRampToValueAtTime(0.0001, now + dur * 1.2);
    osc.connect(og); og.connect(c.destination);
    osc.start(now); osc.stop(now + dur * 1.3);
  }

  function tone(freq, startAt, dur, gain, type) {
    var c = ensure();
    if (!c || !enabled) return;
    var now = c.currentTime + startAt;
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(now); osc.stop(now + dur + 0.05);
  }

  var api = {
    setEnabled: function (v) { enabled = !!v; if (enabled) ensure(); },
    isEnabled: function () { return enabled; },
    unlock: function () { ensure(); },
    move: function () { knock(0.5, 1600, 0.09); },
    capture: function () { knock(0.62, 1100, 0.13); },
    check: function () { knock(0.5, 1400, 0.1); tone(880, 0.09, 0.18, 0.14, 'triangle'); tone(1320, 0.2, 0.2, 0.12, 'triangle'); },
    win: function () { tone(523, 0, 0.16, 0.14, 'triangle'); tone(659, 0.14, 0.16, 0.14, 'triangle'); tone(784, 0.28, 0.3, 0.14, 'triangle'); },
    lose: function () { tone(392, 0, 0.2, 0.14, 'sine'); tone(311, 0.18, 0.28, 0.13, 'sine'); },
    draw: function () { tone(523, 0, 0.18, 0.12, 'sine'); tone(523, 0.2, 0.26, 0.1, 'sine'); },
    select: function () { knock(0.22, 2400, 0.05); },
    error: function () { tone(220, 0, 0.14, 0.1, 'square'); }
  };

  root.XQSound = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
