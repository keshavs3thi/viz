# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

An interactive 3D grid of shapes ("3DVIZ") built with p5.js in WEBGL mode, ported from a Processing sketch (`p5Conversion.pde`, not in this repo). It is a static site with no build step, package manager, linter, or tests. It is deployed as a static page (the repo has had a GitHub Pages `CNAME`, now deleted).

## Running

There's nothing to build. Serve the directory with any static server and open it in a browser:

```
python -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` directly via `file://` mostly works, but the help panel's "Copy values" button needs a secure context for clipboard access (on `file://` it logs the values to the console instead).

## Architecture

- `index.html` loads p5.js **1.11.11** from jsDelivr (p5.sound was removed on purpose), then `panel.js`, then `sketch.js`. Page styles, including the help panel's markup and CSS, are inline in `index.html`.
- `sketch.js` uses p5 **global mode**. All state is module-level `let` variables (shape, grid size, HSB colors, toggles), and the p5 input hooks (`keyPressed`, `keyReleased`, `mouseMoved`, and `mouseDragged`, which forwards to `mouseMoved`) delegate to the `Controls` class, which changes that global state.
- `setup` caps `pixelDensity` at 2 so 3× phone screens don't shade 9× the pixels.
- **Rendering pipeline** (`draw`): set the background, then `updateCamera` → `setupLights` → `drawGrid`. The grid keeps rendering while help is open.
- **Grid layout:** `cols` × `rows` cells are spread over the full canvas width and height. The arrow keys clamp the grid to `MAX_COLS` × `MAX_ROWS`, because each cell is its own draw call. `camZ` is recomputed by `updateCamZ()` (in `setup` and `windowResized`) from the canvas height and the fixed `FOV`, so the grid fits the viewport at any window size.
- **Per-cell transforms** are applied in this order: spring displacement, then `applyWiggle`, then optional rotation, then `drawShape3D`. Values that are the same for every cell (`millis()`, `dt`, `fill`) are computed once per frame in `drawGrid`.
- **Cursor displacement** is physical, not a pure function of the mouse position:
  - `updateCursor` eases a smoothed cursor (`cursorX`/`cursorY`) toward the mouse, and eases `cursorPresence` (0..1) in or out when the mouse enters or leaves the canvas. `mouseInside` is set by `pointermove`/`pointerleave`/`pointerdown` listeners on the canvas element (added in `setup`), not by p5's hooks. p5 listens on `window`, so using its hooks would let the pointer push cells and spawn ripples through the help panel.
  - `stepSpring` gives each cell a target from a `(1 - q)^2` falloff, which reaches exactly zero at `pushRadius`. The target has an outward ring push plus a lift toward the camera, and a damped spring (semi-implicit Euler) moves the cell toward it.
  - Spring state lives in `Float32Array`s indexed `j * cols + i`. They are reallocated, starting at rest, whenever the cell count changes.
  - `dt` is clamped to 1/30 s so the springs stay stable after a stall.
  - **Idle:** once the pointer has been still on the canvas for `idleTimeout` seconds, presence fades out at the slow `idleFade` rate. The next real move fades it back in at the fast `wakeFade` rate (the `waking` flag). Activity is tracked in `lastMoveMs`, which is set by `pointermove` (moves with zero `movementX`/`movementY` are ignored) and `pointerdown`.
  - **Click ripple:** `spawnRipple` zeroes `cursorPresence`, which releases the cursor bump (it fades back in at `presenceFade`), and adds an expanding ring to `ripples` (capped at `MAX_RIPPLES`). `updateRipples` ages each ring once per frame. `stepSpring` adds each ring's crest-and-trough profile to the spring target rather than to the offset, so the springs smooth it.
  - All feel parameters live in the `tune` object at the top of `sketch.js` and are read live every frame. `TUNE_DEFAULTS` is a snapshot used by the panel's Reset button.
  - The WEBGL origin is the canvas center, so mouse coordinates are offset by half the width and height.
- **Pyramid** geometry is built once in `setup` with `buildGeometry(() => drawPyramid(1))` + `computeNormals()` + `clearColors()` (so `fill()` still applies), then drawn with `scale(size); model(pyramidGeom)`. Don't go back to calling `drawPyramid` every frame: the immediate-mode version took about 40× longer per frame.
- **Help panel** (`panel.js`, `HelpPanel`): a frosted DOM overlay, toggled by `setHelp(open)` from H, Esc, the `?` button or the close button. Its sliders are generated from `TUNE_SLIDERS`, which sets each slider's label, range, step and unit. Each slider writes straight into `tune`. "Copy values" copies a `const tune = {...}` literal to paste back into `sketch.js` (this drops the inline comments). The slider ranges for spring stiffness and damping are kept within the semi-implicit Euler stability bound at dt = 1/30 (`k·dt² + 2·c·dt < 4`). While a slider has focus, `Controls.keyPressed` ignores the arrow keys so they adjust the slider. Clicking the canvas removes that focus.
- **Color** uses `colorMode(HSB, 360, 100, 100)` throughout. Holding C or B maps mouse X to hue and mouse Y to saturation for the objects or the background.

When adding a key binding, add it to both `Controls.keyPressed` and the `.keys` list in `index.html`. When adding a value to `tune`, also add a slider entry for it to `TUNE_SLIDERS`.
