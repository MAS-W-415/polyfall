"use strict";

const CELL = 28;
const boardCanvas = document.getElementById("board");
const ctx = boardCanvas.getContext("2d");
const heldCanvas = document.getElementById("held");
const nextCanvas = document.getElementById("next");

// ---------------------------------------------------------------- themes
const T = window.TetrisTheme;
const store = T.store;
let themeKey = T.currentTheme();
let soundOn = store.get("polyfall_sound", true);
let palette = [];
let serverPalette = null;

function buildPalette() {
  palette = T.buildPalette(themeKey, serverPalette);
}

function applyTheme(key) {
  themeKey = key;
  T.applyTheme(key);
  buildPalette();
  buildThemeButtons();
}

// ---------------------------------------------------------------- state
let state = null;
let pollBusy = false;
let startVisible = true;
let settingsApplied = false;
let audioCtx = null;
let levelsBuilt = false;
let lastLevel = 1;
let flash = null;          // {rows, until}
let lockFlash = null;      // {cells, until}
let prevBoard = null;

// ---------------------------------------------------------------- sound
function beep(freq, dur, gain = 0.04) {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = T.themeParams(themeKey).sound || "square";
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.stop(audioCtx.currentTime + dur);
  } catch (err) { /* ignore */ }
}

document.addEventListener("pointerdown", () => {
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}, { once: true });

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
  const c = nextCanvas.getContext("2d");
  if (state.preview_hidden) {
    c.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    c.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted") || "#888";
    c.font = "26px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("?", nextCanvas.width / 2, nextCanvas.height / 2);
  } else {
    drawMini(nextCanvas, state.shapes[state.queue[0]], palette[state.queue[0]]);
  }
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
    beep(660, 0.12, 0.05);
  }
  lastLevel = state.level;
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
    beep(110, 0.06, 0.04);
  }
  const clear = state.last_clear || { rows: [], seq: 0 };
  if (clear.seq !== (detectEvents.seq || 0)) {
    detectEvents.seq = clear.seq;
    if (clear.rows.length) {
      flash = { rows: clear.rows, until: performance.now() + 250 };
      beep(880, 0.1, 0.05);
      setTimeout(() => beep(1320, 0.1, 0.04), 60);
    }
  }
  if (state.game_over && !detectEvents.over) beep(200, 0.5, 0.05);
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
}

function applyStoredSettings(state) {
  if (settingsApplied) return;
  settingsApplied = true;
  const difficulty = store.get("polyfall_difficulty", null);
  if (difficulty !== null) post({ cmd: "difficulty", value: difficulty });
  const assist = store.get("polyfall_assist", null);
  if (assist) post({ cmd: "assist", enabled: !!assist.enabled, level: assist.level || 1 });
  const speed = store.get("polyfall_speed", null);
  if (speed) post({ cmd: "speed_mode", value: speed });
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
  const mapping = keyToCmd(event.key);
  if (!mapping) return;
  event.preventDefault();
  if (event.repeat) return;
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
    if (startVisible) return;
    const command = touchCommand(button);
    post(command);
    const mapping = keyToCmd(button.dataset.cmd === "rotcw" ? "ArrowUp" : "");
    const holdKey = command.cmd === "left" ? "left"
      : command.cmd === "right" ? "right"
        : command.cmd === "down" ? "down" : null;
    if (holdKey) button.dataset.held = holdKey;
    beep(320, 0.03, 0.02);
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
updateDifficultyLabel(0);
setInterval(poll, 33);
poll();
