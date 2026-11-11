/**
 * presets.js — the sample book.
 *
 * Defaults, named bolts, the random-bolt generator, and the URL codec that
 * lets a pattern travel as a link without ever touching a server.
 */

import { mulberry32 } from "./gingham.js";

export function defaults() {
  return {
    style: "check",
    checkX: 48,
    checkY: 48,
    linkChecks: true,
    lineRatio: 0.14,
    seed: 234,
    blend: 0.5,
    weave: "flat",
    threads: 6,
    weaveDepth: 0.75,
    jitter: 0.05,
    grain: 0,
    angle: 0,
    offsetX: 0,
    offsetY: 0,
    primary: { hex: "#c8102e", alpha: 1 },
    secondary: { hex: "#fbf7ef", alpha: 1 },
    accent: { hex: "#1d3557", alpha: 1 },
    width: 1200,
    height: 1200,
    ppi: 300,
    unit: "in",
    matte: "#ffffff",
    backdrop: "checker",
  };
}

/** Named bolts. Each is a full override, applied over the defaults. */
export const PRESETS = [
  {
    name: "Picnic",
    note: "Red and white, 1/6 in check",
    cfg: { style: "check", checkX: 50, checkY: 50, primary: { hex: "#c8102e", alpha: 1 }, secondary: { hex: "#fdfaf3", alpha: 1 }, weave: "flat", grain: 0 },
  },
  {
    name: "Dorothy",
    note: "Blue vichy, fine check",
    cfg: { style: "check", checkX: 26, checkY: 26, primary: { hex: "#3f6fb5", alpha: 1 }, secondary: { hex: "#ffffff", alpha: 1 } },
  },
  {
    name: "Buffalo",
    note: "Big, dark, plaid-shirt scale",
    cfg: { style: "check", checkX: 130, checkY: 130, primary: { hex: "#a41219", alpha: 1 }, secondary: { hex: "#14100f", alpha: 1 }, weave: "twill", threads: 10, weaveDepth: 0.5 },
  },
  {
    name: "Shepherd",
    note: "Small twill check, undyed ground",
    cfg: { style: "check", checkX: 22, checkY: 22, primary: { hex: "#241f1c", alpha: 1 }, secondary: { hex: "#e8e0cd", alpha: 1 }, weave: "twill", threads: 5, weaveDepth: 0.85, jitter: 0.08, grain: 0.12 },
  },
  {
    name: "Pin check",
    note: "As small as it reads at 300 ppi",
    cfg: { style: "check", checkX: 8, checkY: 8, primary: { hex: "#2e5d4b", alpha: 1 }, secondary: { hex: "#f6f4ee", alpha: 1 } },
  },
  {
    name: "Nursery",
    note: "Soft mint, wide check",
    cfg: { style: "check", checkX: 90, checkY: 90, primary: { hex: "#7fbf9e", alpha: 1 }, secondary: { hex: "#fffdf6", alpha: 1 }, blend: 0.5 },
  },
  {
    name: "Ghost",
    note: "One color on nothing — keeps its alpha",
    cfg: { style: "check", checkX: 64, checkY: 64, primary: { hex: "#111827", alpha: 1 }, secondary: { hex: "#000000", alpha: 0 }, backdrop: "checker" },
  },
  {
    name: "Tattersall",
    note: "Two line colors on cream",
    cfg: { style: "tattersall", checkX: 84, checkY: 84, lineRatio: 0.1, primary: { hex: "#9d2933", alpha: 1 }, secondary: { hex: "#f4ecdc", alpha: 1 }, accent: { hex: "#22405e", alpha: 1 } },
  },
  {
    name: "Windowpane",
    note: "Charcoal hairlines on oat",
    cfg: { style: "windowpane", checkX: 150, checkY: 150, lineRatio: 0.045, primary: { hex: "#33302b", alpha: 1 }, secondary: { hex: "#ddd6c6", alpha: 1 } },
  },
  {
    name: "Madras",
    note: "Irregular bands, holiday palette",
    cfg: { style: "madras", checkX: 34, checkY: 34, seed: 812, primary: { hex: "#d1495b", alpha: 1 }, secondary: { hex: "#f7ecd9", alpha: 1 }, accent: { hex: "#00798c", alpha: 1 }, weave: "plain", threads: 4, weaveDepth: 0.7, jitter: 0.07 },
  },
  {
    name: "Bengal",
    note: "Warp stripe, no cross-check",
    cfg: { style: "stripe", checkX: 30, checkY: 30, blend: 0, primary: { hex: "#1f4e79", alpha: 1 }, secondary: { hex: "#fbfbf9", alpha: 1 } },
  },
  {
    name: "Bias neon",
    note: "Turned 45°, acid on ink",
    cfg: { style: "check", checkX: 42, checkY: 42, angle: 45, primary: { hex: "#c6ff3d", alpha: 1 }, secondary: { hex: "#12111a", alpha: 1 }, grain: 0.1 },
  },
];

export function applyPreset(base, preset) {
  const cfg = { ...base, ...preset.cfg };
  cfg.primary = { ...(preset.cfg.primary || base.primary) };
  cfg.secondary = { ...(preset.cfg.secondary || base.secondary) };
  cfg.accent = { ...(preset.cfg.accent || base.accent) };
  if (preset.cfg.checkX != null && preset.cfg.checkY == null) cfg.checkY = cfg.checkX;
  return cfg;
}

/* ------------------------------------------------------------- randomizer */

const HARMONIES = [
  // [secondary lightness, secondary saturation, hue offset for accent]
  { light: 0.96, sat: 0.12, accent: 165 },
  { light: 0.93, sat: 0.06, accent: -140 },
  { light: 0.1, sat: 0.35, accent: 40 },
  { light: 0.98, sat: 0.02, accent: 180 },
];

function hsl(h, s, l) {
  h = ((h % 360) + 360) / 360;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  const c = (v) => v.toString(16).padStart(2, "0");
  return "#" + c(f(0)) + c(f(8)) + c(f(4));
}

/** Pull a random bolt: coherent rather than uniformly random. */
export function randomBolt(base, seed) {
  const rnd = mulberry32((seed ?? Math.floor(Math.random() * 1e9)) >>> 0);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const cfg = { ...base };

  const hue = Math.floor(rnd() * 360);
  const h = pick(HARMONIES);
  cfg.primary = { hex: hsl(hue, 0.45 + rnd() * 0.4, 0.28 + rnd() * 0.24), alpha: 1 };
  cfg.accent = { hex: hsl(hue + h.accent, 0.4 + rnd() * 0.35, 0.3 + rnd() * 0.2), alpha: 1 };
  const transparentGround = rnd() < 0.12;
  cfg.secondary = transparentGround
    ? { hex: "#ffffff", alpha: 0 }
    : { hex: hsl(hue + (rnd() - 0.5) * 40, h.sat, h.light), alpha: 1 };

  cfg.style = pick(["check", "check", "check", "windowpane", "tattersall", "triple", "madras", "stripe"]);
  const size = pick([12, 18, 24, 32, 44, 56, 72, 96, 128]);
  cfg.checkX = size;
  cfg.checkY = rnd() < 0.85 ? size : pick([12, 24, 40, 64]);
  cfg.linkChecks = cfg.checkX === cfg.checkY;
  cfg.lineRatio = 0.05 + rnd() * 0.18;
  cfg.blend = cfg.style === "stripe" ? 0 : 0.5;
  cfg.seed = Math.floor(rnd() * 1000);
  cfg.weave = pick(["flat", "flat", "plain", "twill", "basket"]);
  cfg.threads = pick([4, 5, 6, 8]);
  cfg.weaveDepth = 0.5 + rnd() * 0.4;
  cfg.jitter = rnd() < 0.5 ? 0 : 0.04 + rnd() * 0.08;
  cfg.grain = rnd() < 0.6 ? 0 : Math.round(rnd() * 18) / 100;
  cfg.angle = rnd() < 0.8 ? 0 : pick([45, 45, 30, 15, 90]);
  return cfg;
}

/**
 * A stable, human-readable id for the current cloth. Hashed over a fixed key
 * order so the same pattern gets the same number whether it was just designed
 * or restored from a link.
 */
export function boltNumber(cfg) {
  const s = KEYS.map((k) => {
    const v = cfg[k];
    return v && typeof v === "object" ? `${v.hex}@${v.alpha}` : String(v);
  }).join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().slice(0, 5).padStart(5, "0");
}

/* ------------------------------------------------------------------- link */

const KEYS = [
  "style", "checkX", "checkY", "linkChecks", "lineRatio", "seed", "blend", "weave",
  "threads", "weaveDepth", "jitter", "grain", "angle", "offsetX", "offsetY",
  "primary", "secondary", "accent", "width", "height", "ppi", "unit", "matte", "backdrop",
];

export function encodeConfig(cfg) {
  const slim = {};
  for (const k of KEYS) slim[k] = cfg[k];
  const json = JSON.stringify(slim);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeConfig(str) {
  try {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    const parsed = JSON.parse(json);
    const cfg = defaults();
    for (const k of KEYS) if (parsed[k] !== undefined) cfg[k] = parsed[k];
    return cfg;
  } catch {
    return null;
  }
}
