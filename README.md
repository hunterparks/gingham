# Gingham Mill

A gingham loom that runs entirely in your browser. Set the cloth size in pixels
at a given resolution, pick the yarns, choose how fine the check is, and cut the
result as SVG, PNG, JPEG, WEBP, AVIF, a seamless tile, or a CSS rule.

No render server, no uploads. It's a plain static site hosted on GitHub Pages;
everything happens in the browser.

## Running locally

ES modules need to be served over HTTP, not opened as `file://`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## How it works

A woven cloth is warp threads (columns) crossed by weft threads (rows). Each
axis is a repeating sequence of bands, and each band is dyed with one of three
yarns. The color at a crossing is a mix of its warp yarn and its weft yarn —
which is why classic gingham reads as three tones from only two colors.

Everything downstream draws from one tile, so the preview, the SVG and the PNG
are the same geometry. Band edges are snapped to whole pixels with cumulative
rounding, which keeps the tile seamless and the exports crisp.

Transparency is carried through in premultiplied space, so a transparent
secondary yarn gives you a check that stays semi-transparent where it should and
fully opaque where the colored threads cross — ready to layer over other art.

## Files

| File | Role |
| --- | --- |
| `index.html` | Page markup; loads `app.js` as a module |
| `gingham.js` | The loom: bands, weave structures, color mixing, measuring |
| `render.js` | Canvas painting, SVG output, raster encoding, CSS output |
| `presets.js` | Defaults, the sample book, the random-bolt generator, URL codec |
| `app.js` | State, controls, rulers, export |
| `style.css` | Everything visual |

## Pattern styles

- **Gingham** — the classic even check
- **Windowpane** — thin lines, wide panes
- **Tattersall** — two colors of fine line
- **Triple check** — three-tone grid
- **Madras** — irregular seeded bands
- **Bengal stripe** — warp only, no cross-check

Any of them can be woven flat (solid blocks, smallest files) or with a real
plain, twill or basket interlacing, where individual threads pass over and under
each other.

## Sharing

The whole pattern is encoded into the URL fragment, so a link reproduces the
exact cloth without a database.
