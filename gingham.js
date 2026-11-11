/**
 * gingham.js — the loom.
 *
 * Pure geometry + color. No DOM, no side effects. Everything downstream
 * (canvas preview, SVG export, CSS export, preset chips) is drawn from the
 * single tile this module builds, so every output format agrees exactly.
 *
 * Model: a woven cloth is warp threads (columns) crossed by weft threads
 * (rows). Each axis is a repeating sequence of bands; each band is dyed with
 * one of three yarns. The color at an intersection is a mix of its warp yarn
 * and its weft yarn — which is why classic gingham reads as three tones from
 * two colors (white/white, white/red, red/red).
 */

export const YARN = { GROUND: 0, PRIMARY: 1, ACCENT: 2 };

export const STYLES = [
  { id: "check", name: "Gingham", blurb: "The classic even check", accent: false },
  { id: "windowpane", name: "Windowpane", blurb: "Thin lines, wide panes", accent: false },
  { id: "tattersall", name: "Tattersall", blurb: "Two colors of fine line", accent: true },
  { id: "triple", name: "Triple check", blurb: "Three-tone grid", accent: true },
  { id: "madras", name: "Madras", blurb: "Irregular, seeded bands", accent: true },
  { id: "stripe", name: "Bengal stripe", blurb: "Warp only, no cross-check", accent: false },
];

export const WEAVES = [
  { id: "flat", name: "Flat" },
  { id: "plain", name: "Plain" },
  { id: "twill", name: "Twill" },
  { id: "basket", name: "Basket" },
];

/* ------------------------------------------------------------------ color */

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex) {
  let h = String(hex || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) h = "000000";
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}

export function yarn(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return { r, g, b, a: Math.max(0, Math.min(1, alpha)) };
}

/** Mix two colors in premultiplied space so transparency survives correctly. */
export function mixPremul(c1, c2, t) {
  const u = 1 - t;
  const a = c1.a * u + c2.a * t;
  if (a <= 1e-6) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (c1.r * c1.a * u + c2.r * c2.a * t) / a,
    g: (c1.g * c1.a * u + c2.g * c2.a * t) / a,
    b: (c1.b * c1.a * u + c2.b * c2.a * t) / a,
    a,
  };
}

/** Multiply lightness — used for per-thread yarn variation. */
export function shade(c, f) {
  return { r: c.r * f, g: c.g * f, b: c.b * f, a: c.a };
}

export function toFill(c) {
  const fill = rgbToHex(c);
  const op = Math.round(c.a * 1000) / 1000;
  const css = op >= 1
    ? fill
    : `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${op})`;
  return { fill, op, css };
}

export function relLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/* ------------------------------------------------------------------ bands */

/** Band sequence for one axis, in units of the check size. */
function bandSpec(cfg, axis) {
  const r = Math.max(0.04, Math.min(0.96, cfg.lineRatio));
  const G = YARN.GROUND, P = YARN.PRIMARY, A = YARN.ACCENT;
  switch (cfg.style) {
    case "windowpane":
      return [{ u: r, y: P }, { u: 1 - r, y: G }];
    case "tattersall":
      return [{ u: r, y: P }, { u: 1 - r, y: G }, { u: r, y: A }, { u: 1 - r, y: G }];
    case "triple":
      return [{ u: 1, y: G }, { u: 1, y: P }, { u: 1, y: G }, { u: 1, y: A }];
    case "stripe":
      return axis === "warp" ? [{ u: 1, y: G }, { u: 1, y: P }] : [{ u: 1, y: G }];
    case "madras":
      return madrasBands(cfg.seed + (axis === "warp" ? 0 : 1013));
    case "check":
    default:
      return [{ u: 1, y: G }, { u: 1, y: P }];
  }
}

function madrasBands(seed) {
  const rnd = mulberry32(seed >>> 0);
  const widths = [0.5, 0.75, 1, 1, 1.5, 2, 3];
  const pick = () => widths[Math.floor(rnd() * widths.length)];
  const groups = 4 + Math.floor(rnd() * 4);
  const out = [];
  for (let i = 0; i < groups; i++) {
    out.push({ u: pick(), y: YARN.GROUND });
    out.push({ u: rnd() < 0.62 ? 0.5 : pick(), y: rnd() < 0.6 ? YARN.PRIMARY : YARN.ACCENT });
  }
  return out;
}

/**
 * Turn float widths into whole pixels without losing the total. Cumulative
 * rounding keeps every band edge on a pixel boundary, so the tile stays crisp
 * and the SVG and the PNG land on exactly the same coordinates.
 */
function snapWidths(units, scale) {
  let acc = 0, emitted = 0;
  const out = [];
  for (const u of units) {
    acc += u * scale;
    const w = Math.max(1, Math.round(acc) - emitted);
    out.push(w);
    emitted += w;
  }
  return out;
}

/**
 * Expand bands into strands. Flat cloth gets one strand per band; a woven
 * cloth subdivides each band into individual threads that can pass over and
 * under each other.
 */
function strands(pxWidths, spec, threadPx, rnd, jitter) {
  const out = [];
  let x = 0, i = 0;
  for (let b = 0; b < pxWidths.length; b++) {
    const bandW = pxWidths[b], y = spec[b].y;
    if (!threadPx) {
      out.push({ x, w: bandW, y, j: 1, i: i++ });
      x += bandW;
      continue;
    }
    const count = Math.max(1, Math.round(bandW / threadPx));
    const parts = snapWidths(new Array(count).fill(1), bandW / count);
    let used = 0;
    for (let k = 0; k < count; k++) {
      const w = k === count - 1 ? bandW - used : parts[k];
      used += w;
      if (w <= 0) continue;
      out.push({ x, w, y, j: 1 + (rnd() - 0.5) * 2 * jitter, i: i++ });
      x += w;
    }
  }
  return out;
}

function warpOnTop(weave, i, j) {
  switch (weave) {
    case "twill": return (((i - j) % 4) + 4) % 4 < 2;
    case "basket": return ((i >> 1) + (j >> 1)) % 2 === 0;
    case "plain":
    default: return (i + j) % 2 === 0;
  }
}

const MAX_RECTS = 44000;

/**
 * Build one repeat of the cloth.
 * Returns integer-pixel rects covering a tile of exactly w x h.
 */
export function buildTile(cfg) {
  const warpSpec = bandSpec(cfg, "warp");
  const weftSpec = bandSpec(cfg, "weft");
  const warpPx = snapWidths(warpSpec.map((b) => b.u), Math.max(1, cfg.checkX));
  const weftPx = snapWidths(weftSpec.map((b) => b.u), Math.max(1, cfg.checkY));
  const tileW = warpPx.reduce((a, b) => a + b, 0);
  const tileH = weftPx.reduce((a, b) => a + b, 0);

  const woven = cfg.weave !== "flat";
  let threadPx = null;
  if (woven) {
    threadPx = Math.max(1, Math.round(Math.min(cfg.checkX, cfg.checkY) / cfg.threads));
    // Keep the tile within a rect budget so huge weaves cannot stall export.
    while (Math.ceil(tileW / threadPx) * Math.ceil(tileH / threadPx) > MAX_RECTS) threadPx++;
  }

  const jitter = woven ? cfg.jitter : 0;
  const cols = strands(warpPx, warpSpec, threadPx, mulberry32(cfg.seed + 7), jitter);
  const rows = strands(weftPx, weftSpec, threadPx, mulberry32(cfg.seed + 991), jitter);

  const yarns = [cfg.colors.secondary, cfg.colors.primary, cfg.colors.accent];
  const depth = woven ? cfg.weaveDepth : 0;
  const base = Math.max(0, Math.min(1, cfg.blend));

  const rects = [];
  for (const row of rows) {
    let run = null;
    for (const col of cols) {
      let t = base;
      if (woven) {
        t = warpOnTop(cfg.weave, col.i, row.i) ? base * (1 - depth) : base + (1 - base) * depth;
      }
      let c = mixPremul(yarns[col.y], yarns[row.y], t);
      if (jitter) c = shade(c, col.j * (1 - t) + row.j * t);
      const f = toFill(c);
      // Merge equal neighbours into runs: keeps flat gingham at 4 rects and
      // trims a woven tile substantially.
      if (run && run.css === f.css) {
        run.w += col.w;
      } else {
        run = { x: col.x, y: row.x, w: col.w, h: row.w, ...f };
        rects.push(run);
      }
    }
  }

  return { w: tileW, h: tileH, rects, threadPx, cols: cols.length, rows: rows.length };
}

/* -------------------------------------------------------------- measuring */

export const CM_PER_IN = 2.54;

export function pxToUnit(px, ppi, unit) {
  const inches = px / Math.max(1, ppi);
  return unit === "cm" ? inches * CM_PER_IN : inches;
}

export function unitToPx(value, ppi, unit) {
  const inches = unit === "cm" ? value / CM_PER_IN : value;
  return inches * Math.max(1, ppi);
}

export function fmtLen(px, ppi, unit, digits) {
  const v = pxToUnit(px, ppi, unit);
  const d = digits != null ? digits : v < 1 ? 3 : v < 10 ? 2 : 1;
  return v.toFixed(d);
}
