"use strict";

/* Procedural background music: a lookahead step sequencer with per-theme
   timbres and original motifs (no external assets). Shares the game's
   AudioContext with the sound effects. */

(function () {
  const THEME_MUSIC = {
    dark: {
      bpm: 90, leadWave: "triangle", bassWave: "sine", padWave: "sine",
      filter: 2000, drums: false, motif: "calm",
      progression: [45, 41, 48, 43],  // Am F C G
      scale: [57, 60, 62, 64, 67],    // A C D E G
    },
    pixel: {
      bpm: 120, leadWave: "square", bassWave: "triangle", padWave: "square",
      filter: 3200, drums: true, motif: "upbeat",
      progression: [45, 41, 48, 43],
      scale: [57, 60, 62, 64, 67],
    },
    neon: {
      bpm: 100, leadWave: "sawtooth", bassWave: "sawtooth", padWave: "sawtooth",
      filter: 1500, drums: true, motif: "upbeat",
      progression: [45, 41, 48, 43],
      scale: [57, 60, 62, 64, 67],
    },
    paper: {
      bpm: 84, leadWave: "triangle", bassWave: "sine", padWave: "sine",
      filter: 2200, drums: false, motif: "calm",
      progression: [45, 41, 48, 43],
      scale: [57, 60, 62, 64, 67],
    },
    ocean: {
      bpm: 70, leadWave: "sine", bassWave: "sine", padWave: "sine",
      filter: 1200, drums: false, motif: "ambient",
      progression: [45, 43, 41, 48],
      scale: [57, 60, 62, 64, 67],
    },
    sakura: {
      bpm: 80, leadWave: "triangle", bassWave: "sine", padWave: "triangle",
      filter: 1700, drums: false, motif: "calm",
      progression: [45, 48, 41, 43],
      scale: [57, 60, 62, 64, 67],
    },
    terminal: {
      bpm: 110, leadWave: "square", bassWave: "square", padWave: "triangle",
      filter: 2600, drums: true, motif: "upbeat",
      progression: [45, 41, 48, 43],
      scale: [57, 60, 62, 64, 67],
    },
  };

  const MOTIFS = {
    calm: [
      [0, 2, 4, 2, 3, 2, 1, null],
      [2, 4, null, 4, 3, null, 2, null],
      [4, 3, 2, 3, 4, null, null, null],
      [2, 1, 0, 1, 2, null, null, null],
    ],
    upbeat: [
      [0, 2, 4, 2, 4, 3, 2, 1],
      [2, 4, 2, 4, 5, 4, 3, null],
      [4, 3, 4, 2, 3, 2, 1, 0],
      [1, 2, 3, 4, 3, 2, 1, null],
    ],
    ambient: [
      [0, null, 2, null, null, 4, null, null],
      [2, null, null, 3, null, null, 4, null],
      [4, null, 3, null, 2, null, null, null],
      [1, null, null, 2, null, 0, null, null],
    ],
  };

  let ctx = null;
  let out = null;
  let filter = null;
  let playing = false;
  let timer = null;
  let nextTime = 0;
  let stepIndex = 0;
  let themeKey = "dark";
  let volume = 35;
  let level = 1;

  function midiFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function config() {
    return THEME_MUSIC[themeKey] || THEME_MUSIC.dark;
  }

  function bpm() {
    return config().bpm + Math.min(10, Math.floor(level / 2) * 2);
  }

  function stepDuration() {
    return 30 / bpm();  // eighth note
  }

  function attach(context) {
    if (ctx || !context) return;
    ctx = context;
    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = config().filter;
    out = ctx.createGain();
    out.gain.value = volume / 100 * 0.6;
    filter.connect(out);
    out.connect(ctx.destination);
  }

  function tone(freq, when, dur, wave, gain, attack = 0.012, release = 0.09) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(gain, when + attack);
    const hold = Math.max(attack, dur - release);
    env.gain.setValueAtTime(gain, when + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(env);
    env.connect(filter);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  function kick(when) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, when);
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.1);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.16, when);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
    osc.connect(env);
    env.connect(out);
    osc.start(when);
    osc.stop(when + 0.2);
  }

  function hat(when) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 6500;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.02, when);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
    osc.connect(env);
    env.connect(out);
    osc.start(when);
    osc.stop(when + 0.05);
  }

  function scheduleStep(index, when) {
    const cfg = config();
    const motif = MOTIFS[cfg.motif] || MOTIFS.calm;
    const bar = Math.floor(index / 8) % 4;
    const step = index % 8;
    const dur = stepDuration();

    if (step % 2 === 0) {
      tone(midiFreq(cfg.progression[bar] + 12), when, dur * 1.7,
           cfg.bassWave, 0.10, 0.01, 0.12);
    }

    if (step === 0) {
      [0, 3, 7].forEach((offset, i) => {
        tone(midiFreq(cfg.progression[bar] + 12 + offset), when,
             dur * 7.2, cfg.padWave, 0.028, 0.25, 0.6 + i * 0.1);
      });
    }

    const degree = motif[bar][step];
    if (degree !== null && degree !== undefined) {
      const octave = (Math.floor(index / 32) % 2) * 12;
      const notes = cfg.scale;
      const midi = notes[((degree % notes.length) + notes.length) % notes.length];
      tone(midiFreq(midi + octave), when, dur * 0.9, cfg.leadWave, 0.07);
    }

    if (cfg.drums) {
      if (step % 2 === 0) hat(when);
      if (step === 0 || step === 4) kick(when);
    }
    if (level >= 12 && step === 3) hat(when);
  }

  function tick() {
    if (!ctx || !playing) return;
    const horizon = ctx.currentTime + 0.15;
    while (nextTime < horizon) {
      scheduleStep(stepIndex, nextTime);
      stepIndex = (stepIndex + 1) % 32;
      nextTime += stepDuration();
    }
  }

  function start() {
    if (!ctx || playing) return;
    playing = true;
    stepIndex = 0;
    nextTime = ctx.currentTime + 0.08;
    tick();
    timer = setInterval(tick, 25);
  }

  function stop() {
    playing = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function setVolume(value) {
    volume = Math.max(0, Math.min(100, Number(value)));
    if (out) out.gain.value = volume / 100 * 0.6;
  }

  function setTheme(key) {
    themeKey = THEME_MUSIC[key] ? key : "dark";
    if (filter) filter.frequency.value = config().filter;
  }

  function setIntensity(value) {
    level = Number(value) || 1;
  }

  window.TetrisMusic = {
    attach, start, stop, setVolume, setTheme, setIntensity,
    isPlaying: () => playing,
  };
})();
