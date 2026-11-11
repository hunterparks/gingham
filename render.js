/**
 * render.js — putting the cloth on a surface.
 *
 * Every surface (live preview, PNG, SVG, a preset chip) consumes the same tile
 * from gingham.js and applies the same transform, so what you see is what you
 * export.
 */

import { buildTile, mulberry32 } from "./gingham.js";

/** Draw one repeat into its own canvas, ready to be used as a fill pattern. */
export function tileCanvas(tile) {
  const c = document.createElement("canvas");
  c.width = tile.w;
  c.height = tile.h;
  const ctx = c.getContext("2d");
  for (const r of tile.rects) {
    ctx.fillStyle = r.css;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  return c;
}

/**
 * Pattern placement. Rotation pivots on the middle of the cloth so turning the
 * grain does not slide the pattern off one corner.
 */
function matrix(cfg, W, H, scale) {
  const cx = W / 2, cy = H / 2;
  return new DOMMatrix()
    .scaleSelf(scale, scale)
    .translateSelf(cx, cy)
    .rotateSelf(cfg.angle)
    .translateSelf(-cx + cfg.offsetX, -cy + cfg.offsetY);
}

function svgTransform(cfg, W, H) {
  const cx = W / 2, cy = H / 2;
  const n = (v) => Math.round(v * 1000) / 1000;
  return `translate(${n(cx)} ${n(cy)}) rotate(${n(cfg.angle)}) translate(${n(-cx + cfg.offsetX)} ${n(-cy + cfg.offsetY)})`;
}

/**
 * Monochrome grain, applied only where the cloth is opaque enough to carry it
 * so transparent areas stay clean.
 */
export function applyGrain(ctx, W, H, amount, seed) {
  if (amount <= 0) return;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const rnd = mulberry32(seed >>> 0);
  const k = amount * 90;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const n = (rnd() - 0.5) * k;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Fill a context with the cloth.
 * `scale` maps output pixels to context pixels (1 for export, less for preview).
 */
export function paint(ctx, cfg, W, H, scale, opts = {}) {
  const tile = opts.tile || buildTile(cfg);
  const cw = Math.max(1, Math.round(W * scale));
  const ch = Math.max(1, Math.round(H * scale));

  // A view window lets the preview draw only the visible slice of a very large
  // cloth at 1:1 instead of allocating the whole thing.
  const vx = opts.viewX || 0;
  const vy = opts.viewY || 0;
  const vw = opts.viewW != null ? opts.viewW : cw;
  const vh = opts.viewH != null ? opts.viewH : ch;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, vw, vh);
  ctx.translate(-vx, -vy);

  if (opts.matte) {
    ctx.fillStyle = opts.matte;
    ctx.fillRect(vx, vy, vw, vh);
  }

  const pat = ctx.createPattern(tileCanvas(tile), "repeat");
  pat.setTransform(matrix(cfg, W, H, scale));
  ctx.fillStyle = pat;
  ctx.fillRect(vx, vy, vw, vh);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (cfg.grain > 0) applyGrain(ctx, vw, vh, cfg.grain, cfg.seed + 3);
  return tile;
}

/* -------------------------------------------------------------------- SVG */

export function toSVG(cfg, W, H, opts = {}) {
  const tile = opts.tile || buildTile(cfg);
  const id = "cloth";
  const rects = tile.rects
    .map((r) => {
      const op = r.op >= 1 ? "" : ` fill-opacity="${r.op}"`;
      return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.fill}"${op}/>`;
    })
    .join("");

  const grain = cfg.grain > 0
    ? `<filter id="grain" x="0" y="0" width="100%" height="100%">` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="${cfg.seed % 1000}" result="n"/>` +
      `<feColorMatrix in="n" type="saturate" values="0" result="g"/>` +
      `<feComponentTransfer in="g"><feFuncA type="linear" slope="${(cfg.grain * 0.55).toFixed(3)}"/></feComponentTransfer>` +
      `</filter>`
    : "";
  const grainRect = cfg.grain > 0
    ? `<rect width="${W}" height="${H}" filter="url(#grain)" style="mix-blend-mode:overlay"/>`
    : "";

  const matte = opts.matte ? `<rect width="${W}" height="${H}" fill="${opts.matte}"/>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<title>${escapeXml(opts.title || "Gingham")}</title>
<defs><pattern id="${id}" width="${tile.w}" height="${tile.h}" patternUnits="userSpaceOnUse" patternTransform="${svgTransform(cfg, W, H)}">${rects}</pattern>${grain}</defs>
${matte}<rect width="${W}" height="${H}" fill="url(#${id})"/>
${grainRect}</svg>`;
}

/** One repeat on its own — for CSS backgrounds and seamless tiling. */
export function tileSVG(cfg, opts = {}) {
  const tile = opts.tile || buildTile(cfg);
  const rects = tile.rects
    .map((r) => {
      const op = r.op >= 1 ? "" : ` fill-opacity="${r.op}"`;
      return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.fill}"${op}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tile.w}" height="${tile.h}" viewBox="0 0 ${tile.w} ${tile.h}">${rects}</svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
}

/* ----------------------------------------------------------------- raster */

export function rasterCanvas(cfg, W, H, opts = {}) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  paint(c.getContext("2d"), cfg, W, H, 1, opts);
  return c;
}

export function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

const supportCache = new Map();

/** Ask the browser whether it can actually encode a format before offering it. */
export async function supportsFormat(mime) {
  if (supportCache.has(mime)) return supportCache.get(mime);
  const c = document.createElement("canvas");
  c.width = c.height = 2;
  const blob = await canvasToBlob(c, mime, 0.9);
  const ok = !!blob && blob.type === mime;
  supportCache.set(mime, ok);
  return ok;
}

/* -------------------------------------------------------------------- CSS */

export function toCSS(cfg, opts = {}) {
  const tile = opts.tile || buildTile(cfg);
  const svg = tileSVG(cfg, { tile });
  const uri = `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29")}`;
  const rot = cfg.angle % 360 !== 0
    ? `\n  /* rotated ${cfg.angle}° — wrap in a clipped parent and rotate that */`
    : "";
  return `.gingham {\n  background-image: url("${uri}");\n  background-size: ${tile.w}px ${tile.h}px;\n  background-repeat: repeat;${rot}\n}`;
}
