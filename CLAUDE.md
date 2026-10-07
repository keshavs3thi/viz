# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

An interactive 3D grid of shapes ("3DVIZ") built with p5.js in WEBGL mode, ported from a Processing sketch (`p5Conversion.pde`, not in this repo). It is a static site with no build step, package manager, linter, or tests. It is deployed as a static page (the repo has had a GitHub Pages `CNAME`, now deleted).

## Running

There's nothing to build. Serve the directory with any static server and open it in a browser:

```
python -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` directly via `file://` mostly works, but the async `loadFont` call fetches over the network, so a local server is more reliable.

## Architecture

- `index.html` loads p5.js **1.11.11** from jsDelivr (p5.sound was removed on purpose) and then `sketch.js`. Page styles are inline.
- `sketch.js` uses p5 **global mode**. All state is module-level `let` variables (shape, grid size, HSB colors, toggles), and the p5 global hooks (`setup`, `draw`, `keyPressed`, `keyReleased`, `mouseMoved`) delegate to the `Controls` class, which changes that global state.
- **Rendering pipeline** (`draw`): set the background, then either draw `HelpOverlay` and return early (the grid is not drawn while help is showing), or run `updateCamera` → `setupLights` → `drawGrid`.
- **Grid layout:** `cols` × `rows` cells are spread over the full canvas width and height. The arrow keys clamp the grid to `MAX_COLS` × `MAX_ROWS`, because each cell is its own draw call. `camZ` is recomputed by `updateCamZ()` (in `setup` and `windowResized`) from the canvas height and the fixed `FOV`, so the grid fits the viewport at any window size. `updateCamera()` still re-applies the perspective every frame, because `HelpOverlay` switches to `ortho()`.
- **Per-cell transforms** are applied in this order: cursor push offset (`cursorPushOffset`: exponential core plus a soft quadratic tail with noise jitter), then `applyWiggle`, then optional rotation, then `drawShape3D`. Values that are the same for every cell (`millis()`, the mouse offset, `fill`) are computed once per frame in `drawGrid` and passed in. `cursorPushOffset` returns one shared, reused `pushOut` object. Because the WEBGL origin is the canvas center, mouse coordinates are offset by half the width and height.
- **Pyramid** geometry is built once in `setup` with `buildGeometry(() => drawPyramid(1))` + `computeNormals()` + `clearColors()` (so `fill()` still applies), then drawn with `scale(size); model(pyramidGeom)`. Don't go back to calling `drawPyramid` every frame: the immediate-mode version took about 40× longer per frame.
- **Help screen** pauses rendering: `draw` draws the overlay once and calls `noLoop()`. Pressing H again calls `loop()`. Anything that changes what the help screen shows while it is up has to call `redraw()` (the font-load callback and C/B color picking already do).
- **Color** uses `colorMode(HSB, 360, 100, 100)` throughout. Holding C or B maps mouse X to hue and mouse Y to saturation for the objects or the background.
- `HelpOverlay` draws 2D content inside WEBGL by calling `resetMatrix()` and `ortho()`, then translating to the top-left corner. WEBGL text needs a font to be set, which is why `setup` sets `textFont("sans-serif")` right away and later replaces it with Roboto when that finishes loading.

When adding a key binding, add it to both `Controls.keyPressed` and the help string in `HelpOverlay.draw`.
