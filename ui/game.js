"use strict";

const CELL = 28;
const boardCanvas = document.getElementById("board");
const ctx = boardCanvas.getContext("2d");
const heldCanvas = document.getElementById("held");
const nextCanvas = document.getElementById("next");

// ---------------------------------------------------------------- themes
const T = window.TetrisTheme;
const music = window.TetrisMusic;
const store = T.store;
let themeKey = T.currentTheme();
let soundOn = store.get("polyfall_sound", true);
let musicOn = store.get("polyfall_music", true);
let musicVolume = store.get("polyfall_music_volume", 35);
let palette = [];
let serverPalette = null;

function buildPalette() {
  palette = T.buildPalette(themeKey, serverPalette);
}

function applyTheme(key) {
  themeKey = key;
  T.applyTheme(key);
  music.setTheme(key);
  buildPalette();
  buildThemeButtons();
}

// ---------------------------------------------------------------- state
let state = null;
let pollBusy = false;
let startVisible = true;
let settingsApplied = false;
let levelsBuilt = false;
let lastLevel = 1;
let flash = null;          // {rows, until}
let lockFlash = null;      // {cells, until}
let prevBoard = null;

// ---------------------------------------------------------------- sound
const audio = {
  ctx: null,
  master: null,
  filter: null,
  volume: store.get("polyfall_volume", 50),
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 2400;
    const comp = this.ctx.createDynamicsCompressor();
    this.master = this.ctx.createGain();
    this.master.gain.value = (this.volume / 100) * 0.9;
    this.filter.connect(comp);
    comp.connect(this.master);
    this.master.connect(this.ctx.destination);
  },
  setVolume(value) {
    this.volume = value;
    store.set("polyfall_volume", value);
    if (this.master) this.master.gain.value = (value / 100) * 0.9;
  },
  tone(freq, options = {}) {
    if (!soundOn || this.volume <= 0) return;
    this.ensure();
    if (!this.ctx) return;
    const { to = null, dur = 0.11, gain = 0.15, delay = 0,
            wave = null, attack = 0.014 } = options;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = wave || T.themeParams(themeKey).sound || "triangle";
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.filter);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  },
  seq(notes, step = 0.06, gain = 0.13) {
    notes.forEach((freq, i) => this.tone(freq, {
      dur: step * 1.5, gain, delay: i * step,
    }));
  },
};

const SOUNDS = {
  move: () => audio.tone(300, { dur: 0.045, gain: 0.06 }),
  rotate: () => audio.tone(380, { to: 520, dur: 0.06, gain: 0.08 }),
  soft: () => audio.tone(220, { dur: 0.03, gain: 0.04 }),
  hard: () => audio.tone(190, { to: 95, dur: 0.09, gain: 0.12 }),
  lock: () => audio.tone(150, { to: 100, dur: 0.07, gain: 0.10 }),
  hold: () => {
    audio.tone(440, { dur: 0.06, gain: 0.09 });
    audio.tone(660, { dur: 0.08, gain: 0.09, delay: 0.06 });
  },
  clear1: () => audio.seq([523, 659, 784]),
  clear2: () => audio.seq([523, 659, 784, 1047]),
  clear3: () => audio.seq([523, 659, 784, 988, 1175]),
  clear4: () => audio.seq([523, 659, 784, 1047, 1319, 1568]),
  level: () => audio.seq([523, 659, 784, 1047], 0.09, 0.12),
  over: () => audio.seq([392, 330, 262, 196], 0.17, 0.11),
};

function playSound(name) {
  const fn = SOUNDS[name];
  if (fn) fn();
}

document.addEventListener("pointerdown", () => {
  audio.ensure();
  music.attach(audio.ctx);
  music.setVolume(musicVolume);
  music.setTheme(themeKey);
}, { once: true });
document.addEventListener("keydown", () => {
  audio.ensure();
  music.attach(audio.ctx);
  music.setVolume(musicVolume);
  music.setTheme(themeKey);
}, { once: true });

function musicShouldPlay() {
  return musicOn && musicVolume > 0 && state && !state.paused
    && !state.game_over && !startVisible && !document.hidden;
}

function syncMusic() {
  if (musicShouldPlay()) music.start();
  else music.stop();
}

document.addEventListener("visibilitychange", syncMusic);

// ---------------------------------------------------------------- helpers
function post(cmd) {
  fetch("/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  }).catch(() => {});
}

function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function bestKey() {
  const bucket = Math.round((state ? state.difficulty : 0) * 10);
  return `polyfall_best_d${bucket}`;
}

function updateDifficultyLabel(value) {
  document.getElementById("difficulty-label").textContent = `${Number(value)}%`;
}

// ---------------------------------------------------------------- drawing
function roundRect(c, x, y, w, h, r) {
  if (r <= 0) { c.fillRect(x, y, w, h); return; }
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
  c.fill();
}

function drawCells(cells, color, radius, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (const [r, cc] of cells) {
    roundRect(ctx, cc * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2, radius);
  }
  ctx.globalAlpha = 1;
}

function drawBoard(state) {
  const theme = T.themeParams(themeKey);
  ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--board-bg") || "#0b0e14";
  ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);

  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  for (let c = 0; c <= 10; c++) {
    ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, 20 * CELL); ctx.stroke();
  }
  for (let r = 0; r <= 20; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(10 * CELL, r * CELL); ctx.stroke();
  }

  if (theme.glow > 0) {
    ctx.shadowBlur = theme.glow;
    ctx.shadowColor = "rgba(255,255,255,.35)";
  }
  for (let r = 0; r < 20; r++) {
    for (let c = 0; c < 10; c++) {
      const v = state.board[r][c];
      if (v > 0) drawCells([[r, c]], palette[v - 1] || "#888", theme.radius);
    }
  }
  if (theme.scanlines) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,0,0,.18)";
    for (let r = 0; r < 20; r++) ctx.fillRect(0, r * CELL + CELL - 2, 10 * CELL, 2);
  }
  ctx.shadowBlur = 0;

  if (state.ghost && state.ghost.length && state.active.piece !== null) {
    ctx.globalAlpha = theme.ghost;
    ctx.fillStyle = palette[state.active.piece] || "#fff";
    for (const [r, c] of state.ghost) {
      roundRect(ctx, c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4, theme.radius);
    }
    ctx.globalAlpha = 1;
  }

  if (state.assist && state.assist.enabled && state.assist.target) {
    ctx.save();
    ctx.strokeStyle = state.assist.precise ? "#4cc9f0" : "rgba(76,201,240,0.55)";
    ctx.lineWidth = 3;
    ctx.setLineDash(state.assist.precise ? [] : [6, 4]);
    for (const [r, c] of state.assist.target.cells) {
      ctx.strokeRect(c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4);
    }
    ctx.restore();
  }

  if (state.active.cells && state.active.cells.length) {
    drawCells(state.active.cells, palette[state.active.piece] || "#fff", theme.radius);
  }

  const now = performance.now();
  if (flash && now < flash.until) {
    const alpha = 0.75 * (flash.until - now) / 250;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffffff";
    for (const r of flash.rows) ctx.fillRect(0, r * CELL, 10 * CELL, CELL);
    ctx.globalAlpha = 1;
  }
  if (lockFlash && now < lockFlash.until) {
    const alpha = 0.6 * (lockFlash.until - now) / 160;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffffff";
    for (const [r, c] of lockFlash.cells) {
      roundRect(ctx, c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2, theme.radius);
    }
    ctx.globalAlpha = 1;
  }
  if (state.game_over) {
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
  }
}

function drawMini(canvas, cells, color) {
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, canvas.width, canvas.height);
  if (!cells || !cells.length) return;
  const maxR = Math.max(...cells.map(p => p[0])) + 1;
  const maxC = Math.max(...cells.map(p => p[1])) + 1;
  const size = Math.floor(Math.min(canvas.width / maxC, canvas.height / maxR)) - 2;
  const ox = (canvas.width - size * maxC) / 2;
  const oy = (canvas.height - size * maxR) / 2;
  c.fillStyle = color;
  for (const [r, col] of cells) {
    c.fillRect(ox + col * size, oy + r * size, size - 1, size - 1);
  }
}

function drawSlots(state) {
  if (state.held !== null) {
    drawMini(heldCanvas, state.shapes[state.held], palette[state.held]);
  } else {
    heldCanvas.getContext("2d").clearRect(0, 0, heldCanvas.width, heldCanvas.height);
  }
  drawMini(nextCanvas, state.shapes[state.queue[0]], palette[state.queue[0]]);
}

// ---------------------------------------------------------------- HUD
function updateHud(state) {
  document.getElementById("hud-score").textContent = state.score;
  document.getElementById("hud-lines").textContent = state.lines;
  document.getElementById("hud-level").textContent = state.level;
  const key = bestKey();
  const best = Math.max(store.get(key, 0), state.score);
  store.set(key, best);
  document.getElementById("hud-best").textContent = best;
  document.getElementById("btn-sound").textContent = soundOn ? "🔊" : "🔇";

  let label = "辅助 关";
  if (state.assist.enabled) {
    label = `辅助 L${state.assist.level}`;
  }
  document.getElementById("hud-assist").textContent = label;

  if (state.level > lastLevel) {
    toast(`LEVEL ${state.level}`);
    playSound("level");
  }
  lastLevel = state.level;
  music.setIntensity(state.level);
}

function detectEvents(state) {
  if (!prevBoard) { prevBoard = state.board.map(row => row.slice()); return; }
  const locked = [];
  for (let r = 0; r < 20; r++) {
    for (let c = 0; c < 10; c++) {
      if (state.board[r][c] > 0 && prevBoard[r][c] === 0) locked.push([r, c]);
    }
  }
  if (locked.length && locked.length <= 20) {
    lockFlash = { cells: locked, until: performance.now() + 160 };
    playSound("lock");
  }
  const clear = state.last_clear || { rows: [], seq: 0 };
  if (clear.seq !== (detectEvents.seq || 0)) {
    detectEvents.seq = clear.seq;
    if (clear.rows.length) {
      flash = { rows: clear.rows, until: performance.now() + 250 };
      const n = Math.min(4, Math.max(1, clear.rows.length));
      playSound(`clear${n}`);
    }
  }
  if (state.game_over && !detectEvents.over) playSound("over");
  detectEvents.over = state.game_over;
  prevBoard = state.board.map(row => row.slice());
}

// ---------------------------------------------------------------- overlays
function showStart(show) {
  startVisible = show;
  document.getElementById("start").classList.toggle("hidden", !show);
  if (show) document.getElementById("pause-menu").classList.add("hidden");
}

function updateOverlays(state) {
  document.getElementById("gameover").classList.toggle(
    "hidden", !(state.game_over && !startVisible));
  if (state.game_over && !startVisible) {
    document.getElementById("go-stats").textContent =
      `${state.lines} 行 · ${state.pieces} 块 · ${state.score} 分`;
  }
  document.getElementById("pause-menu").classList.toggle(
    "hidden", !(state.paused && !startVisible && !state.game_over));
}

// ----------------------------------------------------------- start panel
function buildLevels(state) {
  if (levelsBuilt) return;
  const box = document.getElementById("assist-levels");
  box.innerHTML = "";
  for (const lv of state.levels) {
    const btn = document.createElement("button");
    btn.textContent = lv.name;
    btn.dataset.level = lv.level;
    btn.addEventListener("click", () => {
      post({ cmd: "assist", enabled: true, level: lv.level });
      document.getElementById("assist-enabled").checked = true;
      store.set("polyfall_assist", { enabled: true, level: lv.level });
    });
    box.appendChild(btn);
  }
  levelsBuilt = true;
}

function updateLevelButtons(state) {
  const box = document.getElementById("assist-levels");
  for (const btn of box.children) {
    btn.classList.toggle(
      "selected",
      state.assist.enabled && Number(btn.dataset.level) === state.assist.level);
  }
}

function buildThemeButtons() {
  T.buildThemeButtons(document.getElementById("themes"), themeKey, applyTheme);
}

function syncStartControls(state) {
  const slider = document.getElementById("difficulty");
  if (document.activeElement !== slider) {
    slider.value = String(Math.round(state.difficulty * 100));
    updateDifficultyLabel(Math.round(state.difficulty * 100));
  }
  document.getElementById("assist-enabled").checked = state.assist.enabled;
  updateLevelButtons(state);
  document.getElementById("speed-toggle").checked = state.speed_mode === "progressive";
  document.getElementById("sound-toggle").checked = soundOn;
  document.getElementById("volume").value = String(audio.volume);
  document.getElementById("music-toggle").checked = musicOn;
  document.getElementById("music-volume").value = String(musicVolume);
}

const urlParams = new URLSearchParams(location.search);
const urlTheme = urlParams.get("theme");
const urlAssist = urlParams.get("assist");
const urlPlay = urlParams.get("play") === "1";
if (urlPlay) showStart(false);

function applyStoredSettings(state) {
  if (settingsApplied) return;
  settingsApplied = true;
  const difficulty = store.get("polyfall_difficulty", null);
  if (difficulty !== null) post({ cmd: "difficulty", value: difficulty });
  if (urlAssist !== null) {
    const level = Math.max(0, Math.min(3, Number(urlAssist) || 0));
    post({ cmd: "assist", enabled: level > 0, level: Math.max(1, level) });
  } else {
    const assist = store.get("polyfall_assist", null);
    if (assist) post({ cmd: "assist", enabled: !!assist.enabled, level: assist.level || 1 });
  }
  const speed = store.get("polyfall_speed", null);
  if (speed) post({ cmd: "speed_mode", value: speed });
  if (urlPlay) {
    showStart(false);
    post({ cmd: "pause", value: false });
  }
}

// -------------------------------------------------------------- polling
async function poll() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const res = await fetch("/state");
    const data = await res.json();
    if (!serverPalette) {
      serverPalette = data.palette;
      buildPalette();
    }
    state = data;
    applyStoredSettings(data);
    buildLevels(data);
    updateLevelButtons(data);
    drawBoard(data);
    drawSlots(data);
    updateHud(data);
    updateOverlays(data);
    detectEvents(data);
    if (startVisible) syncStartControls(data);
    syncMusic();
  } catch (err) { /* server restarting */ }
  pollBusy = false;
}

// ---------------------------------------------------------------- input
function keyToCmd(key) {
  switch (key) {
    case "ArrowLeft": return { cmd: "left", hold: "left" };
    case "ArrowRight": return { cmd: "right", hold: "right" };
    case "ArrowDown": return { cmd: "down", hold: "down" };
    case "ArrowUp": case "x": case "X": return { cmd: "rotate", cw: true };
    case "z": case "Z": return { cmd: "rotate", cw: false };
    case " ": return { cmd: "hard_drop" };
    case "c": case "C": return { cmd: "hold" };
    default: return null;
  }
}

function cycleAssist() {
  if (!state) return;
  const order = [0, 1, 2, 3];
  const current = state.assist.enabled ? state.assist.level : 0;
  const next = order[(order.indexOf(current) + 1) % order.length];
  if (next === 0) {
    post({ cmd: "assist", enabled: false, level: state.assist.level });
    store.set("polyfall_assist", { enabled: false, level: state.assist.level });
    toast("辅助 关");
  } else {
    post({ cmd: "assist", enabled: true, level: next });
    store.set("polyfall_assist", { enabled: true, level: next });
    toast(`辅助 L${next}`);
  }
}

document.addEventListener("keydown", (event) => {
  if (startVisible) return;
  if (event.key === "p" || event.key === "P") { post({ cmd: "pause" }); return; }
  if (event.key === "r" || event.key === "R") { post({ cmd: "restart" }); return; }
  if (event.key === "a" || event.key === "A") { cycleAssist(); return; }
  if (state && state.paused) return;
  const mapping = keyToCmd(event.key);
  if (!mapping) return;
  event.preventDefault();
  if (event.repeat) return;
  const sound = mapping.cmd === "left" || mapping.cmd === "right" ? "move"
    : mapping.cmd === "down" ? "soft"
      : mapping.cmd === "hard_drop" ? "hard"
        : mapping.cmd === "hold" ? "hold"
          : "rotate";
  playSound(sound);
  post({ cmd: mapping.cmd, cw: mapping.cw });
});

document.addEventListener("keyup", (event) => {
  const mapping = keyToCmd(event.key);
  if (!mapping || !mapping.hold) return;
  post({ cmd: "release", key: mapping.hold });
});

function touchCommand(button) {
  const cmd = button.dataset.cmd;
  if (cmd === "rotcw") return { cmd: "rotate", cw: true };
  if (cmd === "rotccw") return { cmd: "rotate", cw: false };
  return { cmd };
}

for (const button of document.querySelectorAll("#touch button")) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (startVisible || (state && state.paused)) return;
    const command = touchCommand(button);
    post(command);
    const holdKey = command.cmd === "left" ? "left"
      : command.cmd === "right" ? "right"
        : command.cmd === "down" ? "down" : null;
    if (holdKey) button.dataset.held = holdKey;
    const sound = command.cmd === "left" || command.cmd === "right" ? "move"
      : command.cmd === "down" ? "soft"
        : command.cmd === "hard_drop" ? "hard"
          : command.cmd === "hold" ? "hold"
            : "rotate";
    playSound(sound);
  });
  const release = () => {
    if (button.dataset.held) {
      post({ cmd: "release", key: button.dataset.held });
      delete button.dataset.held;
    }
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointerleave", release);
  button.addEventListener("pointercancel", release);
}

// ------------------------------------------------------------ start panel
document.getElementById("difficulty").addEventListener("input", (event) => {
  const v = Number(event.target.value);
  updateDifficultyLabel(v);
  store.set("polyfall_difficulty", v / 100);
  post({ cmd: "difficulty", value: v / 100 });
});

document.getElementById("assist-enabled").addEventListener("change", (event) => {
  const level = state ? state.assist.level : 1;
  post({ cmd: "assist", enabled: event.target.checked, level });
  store.set("polyfall_assist", { enabled: event.target.checked, level });
});

document.getElementById("speed-toggle").addEventListener("change", (event) => {
  const value = event.target.checked ? "progressive" : "fixed";
  post({ cmd: "speed_mode", value });
  store.set("polyfall_speed", value);
});

document.getElementById("sound-toggle").addEventListener("change", (event) => {
  soundOn = event.target.checked;
  store.set("polyfall_sound", soundOn);
});

document.getElementById("volume").addEventListener("input", (event) => {
  audio.setVolume(Number(event.target.value));
});

document.getElementById("music-toggle").addEventListener("change", (event) => {
  musicOn = event.target.checked;
  store.set("polyfall_music", musicOn);
  syncMusic();
});

document.getElementById("music-volume").addEventListener("input", (event) => {
  musicVolume = Number(event.target.value);
  store.set("polyfall_music_volume", musicVolume);
  music.setVolume(musicVolume);
  syncMusic();
});

document.getElementById("btn-sound").addEventListener("click", () => {
  soundOn = !soundOn;
  store.set("polyfall_sound", soundOn);
  document.getElementById("btn-sound").textContent = soundOn ? "🔊" : "🔇";
});

document.getElementById("btn-start").addEventListener("click", () => {
  showStart(false);
  post({ cmd: "restart" });
});
document.getElementById("btn-pause").addEventListener("click", () => {
  const paused = state ? state.paused : false;
  post({ cmd: "pause", value: !paused });
});
document.getElementById("btn-resume").addEventListener("click", () => {
  post({ cmd: "pause", value: false });
});
document.getElementById("btn-restart-pause").addEventListener("click", () => {
  post({ cmd: "restart" });
});
document.getElementById("btn-title").addEventListener("click", () => {
  post({ cmd: "pause", value: true });
  showStart(true);
});
document.getElementById("btn-again").addEventListener("click", () => {
  post({ cmd: "restart" });
});
document.getElementById("btn-title2").addEventListener("click", () => {
  post({ cmd: "pause", value: true });
  showStart(true);
});

buildThemeButtons();
if (urlTheme && T.THEMES[urlTheme]) applyTheme(urlTheme);
updateDifficultyLabel(0);
setInterval(poll, 33);
poll();
