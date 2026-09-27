"use strict";

/* Shared theme system: chrome variables (themes.css) + piece palettes +
   canvas rendering parameters. Used by both the game and observer pages. */

(function () {
  const THEMES = {
    dark: {
      name: "暗夜", swatch: ["#0f1219", "#1a1f2b", "#4cc9f0", "#ffd166"],
      grid: "rgba(128,128,128,.18)", radius: 3, glow: 0, ghost: 0.22,
      scanlines: false, sound: "triangle", server: true,
    },
    pixel: {
      name: "像素", swatch: ["#10190f", "#16240f", "#9ee049", "#d8f0c0"],
      classic: [[0, 240, 240], [240, 240, 0], [216, 64, 216], [0, 240, 0],
                [240, 48, 48], [48, 96, 240], [240, 160, 0]],
      gen: (i) => `hsl(${(i * 45) % 360}, 90%, 55%)`,
      grid: "rgba(0,0,0,.28)", radius: 0, glow: 0, ghost: 0.3,
      scanlines: false, sound: "square",
    },
    neon: {
      name: "霓虹", swatch: ["#0d0716", "#170e26", "#ff4ecd", "#4cc9f0"],
      classic: [[0, 240, 255], [255, 240, 0], [255, 0, 224], [0, 255, 136],
                [255, 51, 85], [51, 102, 255], [255, 136, 0]],
      gen: (i) => `hsl(${(i * 47) % 360}, 100%, 62%)`,
      grid: "rgba(255,255,255,.07)", radius: 2, glow: 12, ghost: 0.15,
      scanlines: false, sound: "sawtooth",
    },
    paper: {
      name: "纸白", swatch: ["#f5f1e6", "#fffdf7", "#b4652a", "#7c7264"],
      classic: [[58, 125, 140], [184, 155, 47], [124, 74, 138], [79, 138, 92],
                [165, 80, 74], [63, 92, 154], [180, 101, 42]],
      gen: (i) => `hsl(${(i * 53) % 360}, 28%, 48%)`,
      grid: "rgba(0,0,0,.14)", radius: 2, glow: 0, ghost: 0.18,
      scanlines: false, sound: "triangle",
    },
    ocean: {
      name: "深海", swatch: ["#061a26", "#0b2b3d", "#39c0d6", "#1d6f8f"],
      classic: [[53, 198, 216], [255, 209, 102], [127, 107, 214], [63, 191, 143],
                [224, 92, 110], [47, 111, 191], [208, 138, 58]],
      gen: (i) => `hsl(${185 + (i * 11) % 80}, 62%, 58%)`,
      grid: "rgba(120,220,255,.10)", radius: 3, glow: 6, ghost: 0.18,
      scanlines: false, sound: "sine",
    },
    sakura: {
      name: "樱花", swatch: ["#fff0f5", "#fff8fb", "#e56a9a", "#c98bd6"],
      classic: [[143, 211, 232], [244, 211, 94], [201, 139, 214], [155, 214, 165],
                [239, 138, 156], [143, 168, 224], [242, 176, 119]],
      gen: (i) => `hsl(${315 + (i * 9) % 85}, 58%, 72%)`,
      grid: "rgba(180,120,150,.18)", radius: 5, glow: 0, ghost: 0.2,
      scanlines: false, sound: "triangle",
    },
    terminal: {
      name: "终端", swatch: ["#020803", "#04120a", "#37ff6b", "#9dffb8"],
      classic: [[55, 255, 107], [157, 255, 184], [31, 214, 85], [107, 255, 143],
                [186, 255, 202], [42, 196, 79], [127, 255, 174]],
      gen: (i) => `hsl(120, 100%, ${35 + (i * 3) % 45}%)`,
      grid: "rgba(60,255,120,.10)", radius: 0, glow: 8, ghost: 0.25,
      scanlines: true, sound: "square",
    },
  };
  const THEME_KEYS = Object.keys(THEMES);

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (err) {
        return fallback;
      }
    },
    set(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
  };

  function currentTheme() {
    const key = store.get("polyfall_theme", "dark");
    return THEMES[key] ? key : "dark";
  }

  function applyTheme(key) {
    document.body.dataset.theme = key;
    store.set("polyfall_theme", key);
  }

  function themeParams(key) {
    return THEMES[key] || THEMES.dark;
  }

  function buildPalette(key, serverPalette) {
    const theme = themeParams(key);
    if (theme.server || !serverPalette) {
      return (serverPalette || []).map(c => `rgb(${c[0]},${c[1]},${c[2]})`);
    }
    const out = [];
    for (let i = 0; i < 26; i++) {
      if (i >= 2 && i <= 8 && theme.classic) {
        const c = theme.classic[i - 2];
        out.push(`rgb(${c[0]},${c[1]},${c[2]})`);
      } else {
        out.push(theme.gen(i));
      }
    }
    return out;
  }

  function buildThemeButtons(container, currentKey, onPick) {
    container.innerHTML = "";
    for (const key of THEME_KEYS) {
      const theme = THEMES[key];
      const btn = document.createElement("button");
      btn.className = "theme-btn";
      btn.classList.toggle("selected", key === currentKey);
      btn.title = theme.name;
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      for (const color of theme.swatch) {
        const dot = document.createElement("i");
        dot.style.background = color;
        swatch.appendChild(dot);
      }
      const label = document.createElement("span");
      label.textContent = theme.name;
      btn.append(swatch, label);
      btn.addEventListener("click", () => onPick(key));
      container.appendChild(btn);
    }
  }

  applyTheme(currentTheme());
  window.TetrisTheme = {
    THEMES, THEME_KEYS, store, currentTheme, applyTheme,
    themeParams, buildPalette, buildThemeButtons,
  };
})();
