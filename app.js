/**
 * app.js — the mill floor.
 *
 * Holds the working state, keeps the controls and the cloth in step, draws the
 * rulers, and cuts the finished piece. Everything runs locally: the only
 * network requests this page makes are for its own files and fonts.
 */

import {
  buildTile, yarn, fmtLen, pxToUnit, unitToPx,
  STYLES, WEAVES, relLuminance, hexToRgb, rgbToHex,
} from "./gingham.js";
import {
  paint, toSVG, tileSVG, rasterCanvas, canvasToBlob, supportsFormat, toCSS,
} from "./render.js";
import {
  defaults, PRESETS, applyPreset, randomBolt, boltNumber, encodeConfig, decodeConfig,
} from "./presets.js";

const $ = (id) => document.getElementById(id);

let state = (location.hash.length > 1 && decodeConfig(location.hash.slice(1))) || defaults();
let zoom = "fit";
let tile = null;
let view = { scale: 1, dispW: 0, dispH: 0, sx: 0, sy: 0 };

const swatchScroll = $("swatchScroll");
const swatch = $("swatch");
const preview = $("preview");
const pctx = preview.getContext("2d");

/* ----------------------------------------------------------- state → engine */

function engineCfg(s) {
  return {
    style: s.style,
    checkX: s.checkX,
    checkY: s.checkY,
    lineRatio: s.lineRatio,
    seed: s.seed,
    blend: s.blend,
    weave: s.weave,
    threads: s.threads,
    weaveDepth: s.weaveDepth,
    jitter: s.jitter,
    grain: s.grain,
    angle: s.angle,
    offsetX: s.offsetX,
    offsetY: s.offsetY,
    colors: {
      primary: yarn(s.primary.hex, s.primary.alpha),
      secondary: yarn(s.secondary.hex, s.secondary.alpha),
      accent: yarn(s.accent.hex, s.accent.alpha),
    },
  };
}

function styleDef() {
  return STYLES.find((s) => s.id === state.style) || STYLES[0];
}

/* ------------------------------------------------------------------ chrome */

/** Lift a color until it can carry small text on the indigo ground. */
function readableOnDark(hex) {
  let c = hexToRgb(hex);
  for (let i = 0; i < 14 && relLuminance(rgbToHex(c)) < 0.3; i++) {
    c = { r: c.r + (255 - c.r) * 0.2, g: c.g + (255 - c.g) * 0.2, b: c.b + (255 - c.b) * 0.2 };
  }
  return rgbToHex(c);
}

/** The instrument takes its accent from the cloth on the loom. */
function tintUI() {
  let src = "#d8a13a";
  if (state.primary.alpha > 0.25) src = state.primary.hex;
  else if (state.secondary.alpha > 0.25) src = state.secondary.hex;
  const accent = readableOnDark(src);
  const root = document.documentElement.style;
  root.setProperty("--accent", accent);
  root.setProperty("--accent-ink", relLuminance(accent) > 0.45 ? "#11161c" : "#f7f4ec");
}

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("is-up");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-up"), 2200);
}

/* ---------------------------------------------------------------- preview */

function drawPreview(cfg) {
  const availW = Math.max(40, swatchScroll.clientWidth);
  const availH = Math.max(40, swatchScroll.clientHeight);
  const W = state.width, H = state.height;

  const scale = zoom === "fit" ? Math.min(availW / W, availH / H, 1) : 1;
  const dispW = Math.max(1, Math.round(W * scale));
  const dispH = Math.max(1, Math.round(H * scale));
  swatch.style.width = dispW + "px";
  swatch.style.height = dispH + "px";

  const viewW = Math.min(dispW, availW);
  const viewH = Math.min(dispH, availH);
  const sx = Math.min(swatchScroll.scrollLeft, Math.max(0, dispW - viewW));
  const sy = Math.min(swatchScroll.scrollTop, Math.max(0, dispH - viewH));

  // Lay the cloth in the middle of the table when it fits; the rulers follow it.
  const padX = zoom === "fit" ? Math.max(0, Math.floor((availW - dispW) / 2)) : 0;
  const padY = zoom === "fit" ? Math.max(0, Math.floor((availH - dispH) / 2)) : 0;
  swatch.style.marginLeft = padX + "px";
  swatch.style.marginTop = padY + "px";

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  preview.style.left = sx + "px";
  preview.style.top = sy + "px";
  preview.style.width = viewW + "px";
  preview.style.height = viewH + "px";
  preview.width = Math.max(1, Math.round(viewW * dpr));
  preview.height = Math.max(1, Math.round(viewH * dpr));

  paint(pctx, cfg, W, H, scale * dpr, {
    tile,
    viewX: Math.round(sx * dpr),
    viewY: Math.round(sy * dpr),
    viewW: preview.width,
    viewH: preview.height,
  });

  view = { scale, dispW, dispH, sx, sy, padX, padY };

  // The mat is ruled in whatever unit you are working in.
  const gridPx = unitToPx(1, state.ppi, state.unit) * scale;
  const step = gridPx > 14 ? gridPx : gridPx > 3 ? gridPx * 4 : 0;
  document.getElementById("mat").style.setProperty(
    "--mat-grid", step ? `${step}px ${step}px` : "0 0");
}

/* ----------------------------------------------------------------- rulers */

const TICK_LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500];

function subdivisions(unitPx, unit) {
  if (unit === "cm") {
    if (unitPx > 90) return 10;
    if (unitPx > 45) return 5;
    return unitPx > 22 ? 2 : 1;
  }
  if (unitPx > 150) return 8;
  if (unitPx > 76) return 4;
  return unitPx > 36 ? 2 : 1;
}

function drawRuler(cv, axis) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssLen = (axis === "x" ? cv.clientWidth : cv.clientHeight) ||
    (axis === "x" ? swatchScroll.clientWidth : swatchScroll.clientHeight);
  const thick = 30;
  cv.width = Math.max(1, Math.round((axis === "x" ? cssLen : thick) * dpr));
  cv.height = Math.max(1, Math.round((axis === "x" ? thick : cssLen) * dpr));

  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim() || "#d8a13a";
  ctx.clearRect(0, 0, cv.width, cv.height);

  const unitPx = unitToPx(1, state.ppi, state.unit) * view.scale;
  if (!isFinite(unitPx) || unitPx <= 0) return;

  let step = TICK_LADDER.find((s) => s * unitPx >= 38) || 500;
  const subs = subdivisions(unitPx * step, state.unit);
  const scroll = axis === "x" ? view.sx : view.sy;
  const pad = (axis === "x" ? view.padX : view.padY) || 0;
  const clothLen = axis === "x" ? view.dispW : view.dispH;
  const minor = unitPx * step / subs;

  ctx.font = "500 9px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.textBaseline = axis === "x" ? "alphabetic" : "middle";

  // The cloth edge, marked in the accent so the zero point is unmistakable.
  ctx.fillStyle = accent;
  const edge = Math.max(0, Math.min(cssLen - pad, clothLen - scroll));
  if (axis === "x") ctx.fillRect(pad, thick - 1.5, edge, 1.5);
  else ctx.fillRect(thick - 1.5, pad, 1.5, edge);

  let i = 0;
  for (;; i++) {
    const pos = i * minor - scroll + pad;
    if (pos > cssLen + 1) break;
    if (i * minor > clothLen + 1) break;
    if (pos < -1) continue;

    const isMajor = i % subs === 0;
    const isHalf = !isMajor && subs % 2 === 0 && i % (subs / 2) === 0;
    const len = isMajor ? 11 : isHalf ? 7 : 4;
    ctx.fillStyle = isMajor ? "#93a6b8" : "#4d6175";

    if (axis === "x") {
      ctx.fillRect(Math.round(pos), thick - 2 - len, 1, len);
      if (isMajor) {
        const label = String((i / subs) * step);
        ctx.fillStyle = "#93a6b8";
        ctx.fillText(label, Math.round(pos) + 3, 11);
      }
    } else {
      ctx.fillRect(thick - 2 - len, Math.round(pos), len, 1);
      if (isMajor) {
        const label = String((i / subs) * step);
        ctx.fillStyle = "#93a6b8";
        ctx.save();
        ctx.translate(4, Math.round(pos) + 9);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }
}

function drawRulers() {
  drawRuler($("rulerTop"), "x");
  drawRuler($("rulerLeft"), "y");
}

/* -------------------------------------------------------------- readouts */

function unitName() {
  return state.unit === "cm" ? "cm" : "in";
}

function updateReadouts() {
  const u = unitName();
  $("specBolt").textContent = "№ " + boltNumber(state);
  $("specSize").textContent =
    `${state.width}×${state.height} px · ${fmtLen(state.width, state.ppi, state.unit, 2)}×${fmtLen(state.height, state.ppi, state.unit, 2)} ${u} @ ${state.ppi} ppi`;

  const across = state.width / tile.w;
  const down = state.height / tile.h;
  $("specRepeat").textContent = `${tile.w}×${tile.h} px · ${across.toFixed(1)}×${down.toFixed(1)}`;

  $("caliperText").textContent =
    `one repeat — ${tile.w}×${tile.h} px, ${fmtLen(tile.w, state.ppi, state.unit)}×${fmtLen(tile.h, state.ppi, state.unit)} ${u}` +
    (tile.threadPx ? ` · ${tile.threadPx} px thread` : "");

  $("checkXOut").textContent = `${fmtLen(state.checkX, state.ppi, state.unit)} ${u}`;
  $("checkYOut").textContent = `${fmtLen(state.checkY, state.ppi, state.unit)} ${u}`;
  $("unitBadge").textContent = u;
  for (const el of document.querySelectorAll(".unit-label")) el.textContent = u;

  const mp = (state.width * state.height) / 1e6;
  const warn = $("sizeWarn");
  if (mp > 16) {
    warn.hidden = false;
    warn.textContent = `${mp.toFixed(1)} megapixels. Raster export will take a moment and needs about ${(mp * 4).toFixed(0)} MB of memory; mobile Safari caps canvases near 16 MP.`;
  } else {
    warn.hidden = true;
  }

  const ppiNote = state.ppi >= 250 ? "print" : state.ppi >= 144 ? "retina" : "screen";
  $("ppiNote").textContent = ppiNote;
}

/* ------------------------------------------------------------ render loop */

let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const cfg = engineCfg(state);
    tile = buildTile(cfg);
    tintUI();
    drawPreview(cfg);
    drawRulers();
    updateReadouts();
    pushHash();
  });
}

let hashTimer;
function pushHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    history.replaceState(null, "", "#" + encodeConfig(state));
  }, 500);
}

/* ------------------------------------------------------------- build UI */

function buildStyleGrid() {
  const grid = $("styleGrid");
  grid.innerHTML = "";
  for (const s of STYLES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "style-btn";
    b.dataset.style = s.id;
    b.textContent = s.name;
    b.setAttribute("role", "radio");
    b.addEventListener("click", () => {
      if (state.style === "stripe" && s.id !== "stripe" && state.blend === 0) state.blend = 0.5;
      if (s.id === "stripe" && state.blend === 0.5) state.blend = 0;
      state.style = s.id;
      syncControls();
      schedule();
    });
    grid.appendChild(b);
  }
}

function buildWeaveSeg() {
  const seg = $("weaveSeg");
  seg.innerHTML = "";
  for (const w of WEAVES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg-btn";
    b.dataset.weave = w.id;
    b.textContent = w.name.toLowerCase();
    b.addEventListener("click", () => {
      state.weave = w.id;
      syncControls();
      schedule();
    });
    seg.appendChild(b);
  }
}

const CHIP_PX = 96;

function buildChips() {
  const wrap = $("presetChips");
  wrap.innerHTML = "";
  for (const preset of PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.title = preset.note;

    const cv = document.createElement("canvas");
    cv.width = cv.height = CHIP_PX;
    const cfg = engineCfg(applyPreset(defaults(), preset));
    // Normalise every chip to show roughly two repeats, so the sample book
    // reads as a set rather than a jumble of scales.
    const probe = buildTile(cfg);
    const k = Math.min(4, Math.max(0.06, (CHIP_PX / 2.2) / Math.max(probe.w, probe.h)));
    const chipCfg = {
      ...cfg,
      checkX: Math.max(1, Math.round(cfg.checkX * k)),
      checkY: Math.max(1, Math.round(cfg.checkY * k)),
      grain: 0,
    };
    const ctx = cv.getContext("2d");
    paint(ctx, chipCfg, CHIP_PX, CHIP_PX, 1);
    // Slide a checkerboard underneath so a transparent yarn reads as clear
    // rather than as the panel behind it.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#c9c9c9";
    ctx.fillRect(0, 0, CHIP_PX, CHIP_PX);
    ctx.fillStyle = "#9a9a9a";
    for (let y = 0; y < CHIP_PX; y += 8) {
      for (let x = 0; x < CHIP_PX; x += 8) {
        if (((x + y) / 8) % 2 === 0) ctx.fillRect(x, y, 8, 8);
      }
    }
    ctx.globalCompositeOperation = "source-over";

    const name = document.createElement("b");
    name.textContent = preset.name;
    btn.append(cv, name);
    btn.addEventListener("click", () => {
      const keep = { width: state.width, height: state.height, ppi: state.ppi, unit: state.unit, matte: state.matte };
      state = { ...applyPreset(defaults(), preset), ...keep };
      syncControls();
      schedule();
      toast(`${preset.name} — ${preset.note}`);
    });
    wrap.appendChild(btn);
  }
}

/* --------------------------------------------------- controls → state ← */

function syncControls() {
  const s = state;

  for (const b of document.querySelectorAll(".style-btn")) {
    const on = b.dataset.style === s.style;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  }
  $("styleBlurb").textContent = styleDef().blurb + ".";

  for (const b of document.querySelectorAll("#weaveSeg .seg-btn")) {
    b.classList.toggle("is-on", b.dataset.weave === s.weave);
  }
  for (const b of document.querySelectorAll("[data-unit]")) {
    b.classList.toggle("is-on", b.dataset.unit === s.unit);
  }
  for (const b of document.querySelectorAll("[data-backdrop]")) {
    b.classList.toggle("is-on", b.dataset.backdrop === s.backdrop);
  }
  for (const b of document.querySelectorAll("[data-zoom]")) {
    b.classList.toggle("is-on", b.dataset.zoom === zoom);
  }
  swatch.dataset.backdrop = s.backdrop;

  for (const key of ["primary", "secondary", "accent"]) {
    setVal($(key + "Color"), s[key].hex);
    setVal($(key + "Hex"), s[key].hex);
    $(key + "Alpha").value = Math.round(s[key].alpha * 100);
    $(key + "AlphaOut").textContent =
      s[key].alpha === 0 ? "clear" : Math.round(s[key].alpha * 100) + "%";
  }
  $("accentYarn").hidden = !styleDef().accent;

  $("blend").value = Math.round(s.blend * 100);
  $("blendOut").textContent =
    s.blend === 0.5 ? "even" : s.blend === 0 ? "warp" : s.blend === 1 ? "weft" : Math.round(s.blend * 100) + "%";

  setVal($("checkX"), s.checkX);
  setVal($("checkY"), s.checkY);
  $("linkChecks").classList.toggle("is-on", s.linkChecks);
  $("linkChecks").setAttribute("aria-pressed", s.linkChecks ? "true" : "false");
  $("checkYRow").hidden = s.linkChecks;

  $("lineRatioRow").hidden = !(s.style === "windowpane" || s.style === "tattersall");
  $("lineRatio").value = Math.round(s.lineRatio * 100);
  $("lineRatioOut").textContent = Math.round(s.lineRatio * 100) + "%";

  $("seedRow").hidden = s.style !== "madras";
  $("seed").value = s.seed;
  $("seedOut").textContent = s.seed;

  $("angle").value = s.angle;
  $("angleOut").textContent = s.angle + "°";
  $("offsetX").value = s.offsetX;
  $("offsetXOut").textContent = s.offsetX + " px";
  $("offsetY").value = s.offsetY;
  $("offsetYOut").textContent = s.offsetY + " px";

  for (const el of document.querySelectorAll(".weave-only")) el.hidden = s.weave === "flat";
  $("weaveHint").textContent = s.weave === "flat"
    ? "Flat keeps every check a solid block — the cleanest export and the smallest file."
    : "Threads pass over and under each other. Zoom to 1:1 to see the interlacing.";

  $("threads").value = s.threads;
  $("threadsOut").textContent = s.threads;
  $("weaveDepth").value = Math.round(s.weaveDepth * 100);
  $("weaveDepthOut").textContent = Math.round(s.weaveDepth * 100) + "%";
  $("jitter").value = Math.round(s.jitter * 100);
  $("jitterOut").textContent = Math.round(s.jitter * 100) + "%";
  $("grain").value = Math.round(s.grain * 100);
  $("grainOut").textContent = s.grain === 0 ? "off" : Math.round(s.grain * 100) + "%";

  setVal($("width"), s.width);
  setVal($("height"), s.height);
  setVal($("ppi"), s.ppi);
  setVal($("widthUnit"), round2(pxToUnit(s.width, s.ppi, s.unit)));
  setVal($("heightUnit"), round2(pxToUnit(s.height, s.ppi, s.unit)));
  $("matteColor").value = s.matte;
}

/** Never overwrite the field currently under the cursor. */
function setVal(el, v) {
  if (el !== document.activeElement) el.value = v;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

/* --------------------------------------------------------------- wiring */

function wire() {
  // Yarn colors
  for (const key of ["primary", "secondary", "accent"]) {
    $(key + "Color").addEventListener("input", (e) => {
      state[key] = { hex: e.target.value, alpha: state[key].alpha > 0 ? state[key].alpha : 1 };
      syncControls();
      schedule();
    });
    $(key + "Hex").addEventListener("change", (e) => {
      const v = e.target.value.trim();
      if (/^#?[0-9a-fA-F]{3}$|^#?[0-9a-fA-F]{6}$/.test(v)) {
        state[key].hex = rgbToHex(hexToRgb(v));
      }
      syncControls();
      schedule();
    });
    $(key + "Alpha").addEventListener("input", (e) => {
      state[key].alpha = Number(e.target.value) / 100;
      syncControls();
      schedule();
    });
  }
  for (const b of document.querySelectorAll("[data-clear]")) {
    b.addEventListener("click", () => {
      const k = b.dataset.clear;
      state[k].alpha = state[k].alpha === 0 ? 1 : 0;
      syncControls();
      schedule();
    });
  }

  slider("blend", (v) => (state.blend = v / 100));
  slider("lineRatio", (v) => (state.lineRatio = v / 100));
  slider("seed", (v) => (state.seed = v));
  slider("angle", (v) => (state.angle = v));
  slider("offsetX", (v) => (state.offsetX = v));
  slider("offsetY", (v) => (state.offsetY = v));
  slider("threads", (v) => (state.threads = v));
  slider("weaveDepth", (v) => (state.weaveDepth = v / 100));
  slider("jitter", (v) => (state.jitter = v / 100));
  slider("grain", (v) => (state.grain = v / 100));

  $("checkX").addEventListener("input", (e) => {
    state.checkX = clampInt(e.target.value, 1, 2000, state.checkX);
    if (state.linkChecks) state.checkY = state.checkX;
    syncControls();
    schedule();
  });
  $("checkY").addEventListener("input", (e) => {
    state.checkY = clampInt(e.target.value, 1, 2000, state.checkY);
    syncControls();
    schedule();
  });
  $("linkChecks").addEventListener("click", () => {
    state.linkChecks = !state.linkChecks;
    if (state.linkChecks) state.checkY = state.checkX;
    syncControls();
    schedule();
  });

  for (const b of document.querySelectorAll("#angleQuick .tiny")) {
    b.addEventListener("click", () => {
      state.angle = Number(b.dataset.angle);
      syncControls();
      schedule();
    });
  }

  // Cloth size: pixels and physical length stay in step through the ppi.
  $("width").addEventListener("input", (e) => {
    state.width = clampInt(e.target.value, 1, 20000, state.width);
    syncControls();
    schedule();
  });
  $("height").addEventListener("input", (e) => {
    state.height = clampInt(e.target.value, 1, 20000, state.height);
    syncControls();
    schedule();
  });
  $("ppi").addEventListener("input", (e) => {
    state.ppi = clampInt(e.target.value, 1, 2400, state.ppi);
    syncControls();
    schedule();
  });
  $("widthUnit").addEventListener("input", (e) => {
    const n = Number(e.target.value);
    if (!isFinite(n) || n <= 0) return;
    state.width = clampInt(unitToPx(n, state.ppi, state.unit), 1, 20000, state.width);
    $("width").value = state.width;
    schedule();
  });
  $("heightUnit").addEventListener("input", (e) => {
    const n = Number(e.target.value);
    if (!isFinite(n) || n <= 0) return;
    state.height = clampInt(unitToPx(n, state.ppi, state.unit), 1, 20000, state.height);
    $("height").value = state.height;
    schedule();
  });

  for (const b of document.querySelectorAll("#sizeQuick .tiny")) {
    b.addEventListener("click", () => {
      const [w, h, p] = b.dataset.size.split(",").map(Number);
      state.width = w;
      state.height = h;
      state.ppi = p;
      syncControls();
      schedule();
    });
  }

  for (const b of document.querySelectorAll("[data-unit]")) {
    b.addEventListener("click", () => {
      state.unit = b.dataset.unit;
      syncControls();
      schedule();
    });
  }
  for (const b of document.querySelectorAll("[data-backdrop]")) {
    b.addEventListener("click", () => {
      state.backdrop = b.dataset.backdrop;
      syncControls();
      schedule();
    });
  }
  for (const b of document.querySelectorAll("[data-zoom]")) {
    b.addEventListener("click", () => {
      zoom = b.dataset.zoom;
      swatchScroll.scrollTo(0, 0);
      syncControls();
      schedule();
    });
  }

  $("matteColor").addEventListener("input", (e) => (state.matte = e.target.value));
  $("quality").addEventListener("input", (e) => ($("qualityOut").textContent = e.target.value));

  $("randomBolt").addEventListener("click", pullBolt);

  swatchScroll.addEventListener("scroll", () => schedule(), { passive: true });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(schedule, 80);
  });

  // The first paint can land before fonts and flex have settled, which would
  // leave the cloth scaled to a stale box.
  if (window.ResizeObserver) {
    new ResizeObserver(() => schedule()).observe(swatchScroll);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      pullBolt();
    }
  });

  wireExport();
}

function slider(id, apply) {
  $(id).addEventListener("input", (e) => {
    apply(Number(e.target.value));
    syncControls();
    schedule();
  });
}

function pullBolt() {
  const keep = { width: state.width, height: state.height, ppi: state.ppi, unit: state.unit, matte: state.matte, backdrop: state.backdrop };
  state = { ...randomBolt(defaults()), ...keep };
  syncControls();
  schedule();
  toast("Bolt № " + boltNumber(state));
}

/* --------------------------------------------------------------- export */

const MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

function baseName() {
  return `gingham-${state.style}-${state.width}x${state.height}-${state.ppi}ppi`;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function exportFormat(fmt) {
  const cfg = engineCfg(state);
  if (fmt === "svg") {
    const svg = toSVG(cfg, state.width, state.height, { tile, title: `Gingham № ${boltNumber(state)}` });
    download(new Blob([svg], { type: "image/svg+xml" }), baseName() + ".svg");
    toast(`SVG cut — ${(svg.length / 1024).toFixed(1)} KB, ${tile.rects.length} shapes per repeat`);
    return;
  }

  const mime = MIME[fmt];
  const opaque = fmt === "jpeg";
  toast("Weaving " + fmt.toUpperCase() + "…");
  await new Promise((r) => setTimeout(r, 16));

  let canvas;
  try {
    canvas = rasterCanvas(cfg, state.width, state.height, { tile, matte: opaque ? state.matte : null });
  } catch (err) {
    toast("That canvas is too large for this browser. Try fewer pixels.");
    return;
  }
  const blob = await canvasToBlob(canvas, mime, Number($("quality").value) / 100);
  if (!blob) {
    toast("This browser could not encode " + fmt.toUpperCase() + ".");
    return;
  }
  download(blob, `${baseName()}.${fmt === "jpeg" ? "jpg" : fmt}`);
  toast(`${fmt.toUpperCase()} cut — ${(blob.size / 1024).toFixed(0)} KB`);
}

async function copyText(text, note) {
  try {
    await navigator.clipboard.writeText(text);
    toast(note);
  } catch {
    toast("Clipboard blocked by the browser.");
  }
}

async function runAction(act) {
  const cfg = engineCfg(state);
  if (act === "tile-svg") {
    download(new Blob([tileSVG(cfg, { tile })], { type: "image/svg+xml" }), `${baseName()}-tile.svg`);
    toast(`Seamless tile — ${tile.w}×${tile.h} px`);
  } else if (act === "tile-png") {
    const c = rasterCanvas(cfg, tile.w, tile.h, { tile });
    const blob = await canvasToBlob(c, "image/png");
    download(blob, `${baseName()}-tile.png`);
    toast(`Seamless tile — ${tile.w}×${tile.h} px`);
  } else if (act === "css") {
    copyText(toCSS(cfg, { tile }), "CSS rule copied");
  } else if (act === "clipboard") {
    try {
      const c = rasterCanvas(cfg, state.width, state.height, { tile });
      const blob = await canvasToBlob(c, "image/png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("PNG copied to the clipboard");
    } catch {
      toast("This browser will not accept an image on the clipboard.");
    }
  } else if (act === "link") {
    const url = location.origin + location.pathname + "#" + encodeConfig(state);
    copyText(url, "Link copied — the pattern travels in the URL");
  }
}

function wireExport() {
  for (const b of document.querySelectorAll("[data-fmt]")) {
    b.addEventListener("click", () => exportFormat(b.dataset.fmt));
  }
  for (const b of document.querySelectorAll("[data-act]")) {
    b.addEventListener("click", () => runAction(b.dataset.act));
  }
  supportsFormat("image/avif").then((ok) => {
    if (ok) document.querySelector('[data-fmt="avif"]').hidden = false;
  });
  supportsFormat("image/webp").then((ok) => {
    if (!ok) document.querySelector('[data-fmt="webp"]').hidden = true;
  });
}

/* ------------------------------------------------------------------ boot */

buildStyleGrid();
buildWeaveSeg();
buildChips();
wire();
syncControls();
schedule();

window.addEventListener("hashchange", () => {
  const next = decodeConfig(location.hash.slice(1));
  if (next) {
    state = next;
    syncControls();
    schedule();
  }
});
