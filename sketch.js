// 3D INTERACTIVE MATRIX
// Converted from Processing (p5Conversion.pde) to p5.js.

const SHAPE_CUBE = 0;
const SHAPE_SPHERE = 1;
const SHAPE_PYRAMID = 2;

const MAX_COLS = 80;
const MAX_ROWS = 45;
const FOV = Math.PI / 3;

// Responsive layout. The grid is sized from the window on load and on every
// resize/rotation (manual changes from keys or sliders last until then): cells
// sit about GRID_SPACING px apart and shapes fill SHAPE_FILL of that spacing.
const GRID_SPACING = 46;
const SHAPE_FILL = 0.6;
// The px values in `tune` (push and ripple) are authored for a window whose
// shorter side is REFERENCE_SIZE px, and scaled by viewScale on other screens.
const REFERENCE_SIZE = 800;
const MIN_VIEW_SCALE = 0.6;
const MAX_VIEW_SCALE = 1.5;
let viewScale = 1;

let currentShape = SHAPE_CUBE;
let shapeSize = 28;
const MIN_SHAPE_SIZE = 4;
const MAX_SHAPE_SIZE = 120;
let pyramidGeom = null; // unit-size pyramid, built once in setup()

let objectHue = 130;
let objectSat = 80;
let bgHue = 50;
let bgSat = 80;
let bgBri = 100;
// Motion tuning, read live every frame. The help panel (H) has a slider for
// each value, and its "Copy values" button copies a replacement for this object.
// px values are at REFERENCE_SIZE; see viewScale.
const tune = {
  pushRadius: 170,
  pushStrength: 7,
  pushLift: 40,
  springStiffness: 140,
  springDamping: 15,
  cursorFollow: 15,
  presenceFade: 4,
  rippleStrength: 30,
  rippleSpeed: 760,
  rippleWidth: 80,
  rippleLife: 1.2,
  idleTimeout: 3,
  idleFade: 0.6,
  wakeFade: 14,
};
const TUNE_DEFAULTS = { ...tune };

// Click ripples: rings in WEBGL coordinates. radius and amp are refreshed per frame.
const MAX_RIPPLES = 8;
const RIPPLE_SPREAD = 0.3; // px of outward push per px of ripple lift
let ripples = [];

let camZ = 0;

// Smoothed cursor in WEBGL (center-origin) coordinates, and its 0..1 presence.
let cursorX = 0;
let cursorY = 0;
let cursorPresence = 0;
let mouseInside = false;
// Idle: the pointer has sat still on the canvas for idleTimeout seconds, so the
// effect fades out slowly. Waking: it moved again, so the effect fades back in fast.
let lastMoveMs = 0;
let idle = false;
let waking = false;

// Per-cell spring state (offset + velocity), indexed j * cols + i.
let springCount = 0;
let offX, offY, offZ, velX, velY, velZ;

let showHelp = false;
let cHeld = false;
let bHeld = false;
let rotating = false;
let wiggle = true;

let controls;
let helpPanel;
let cols = 32; // replaced by fitToWindow() in setup
let rows = 18;

function setup() {
  // Cap density so very high-DPI screens (3x phones) don't shade 9x the pixels.
  pixelDensity(Math.min(2, displayDensity()));
  const cnv = createCanvas(windowWidth, windowHeight, WEBGL);
  // Pointer listeners on the canvas itself (p5's hooks fire on window), so the
  // help panel blocks the push and clicks on it don't make ripples. Leaving
  // fades the displacement out instead of freezing it. Near the corner buttons
  // also counts as off-canvas: the system cursor shows and the push fades out,
  // so aiming at a button (or crossing the gaps between them) doesn't flicker
  // the cursor or the effect.
  const setNearUI = (near) => {
    mouseInside = !near;
    cnv.elt.style.cursor = near ? "default" : "none";
  };
  cnv.elt.addEventListener("pointermove", (e) => {
    setNearUI(helpPanel.nearCorner(e.clientX, e.clientY));
    // Browsers can send zero-distance moves (e.g. after layout); those aren't activity.
    if (e.movementX !== 0 || e.movementY !== 0) lastMoveMs = millis();
  });
  cnv.elt.addEventListener("pointerleave", () => (mouseInside = false));
  // Taps on the canvas are ours: cancel the browser's double-tap zoom and the
  // synthetic click (pointer events above still fire). iOS also needs its pinch
  // gesture events cancelled, since it ignores user-scalable=no.
  cnv.elt.addEventListener("touchend", (e) => e.preventDefault(), { passive: false });
  cnv.elt.addEventListener("dblclick", (e) => e.preventDefault());
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  cnv.elt.addEventListener("pointerdown", (e) => {
    // Hand the keyboard back to the grid if a panel slider had focus.
    if (document.activeElement) document.activeElement.blur();
    // A near miss on a corner button shouldn't send a ripple.
    if (helpPanel.nearCorner(e.clientX, e.clientY)) return;
    setNearUI(false);
    lastMoveMs = millis();
    spawnRipple(e.offsetX - width * 0.5, e.offsetY - height * 0.5);
  });
  colorMode(HSB, 360, 100, 100);
  noStroke();
  noCursor();
  updateCamZ();
  fitToWindow();

  // Build the pyramid once at unit size; drawShape3D() scales it per cell.
  pyramidGeom = buildGeometry(() => drawPyramid(1));
  pyramidGeom.computeNormals();
  // Drop baked vertex colors so fill() still controls the pyramid's color.
  if (pyramidGeom.clearColors) pyramidGeom.clearColors();

  controls = new Controls();
  helpPanel = new HelpPanel();
}

function setHelp(open) {
  showHelp = open;
  helpPanel.setOpen(open);
}

function updateCamZ() {
  camZ = (height * 0.5) / Math.tan(FOV * 0.5) * 1.02; // fit grid to view with small margin
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  updateCamZ();
  fitToWindow();
  if (helpPanel) helpPanel.syncState();
}

// Size the grid and the motion scale to the current canvas.
function fitToWindow() {
  cols = constrain(Math.round(width / GRID_SPACING) + 1, 2, MAX_COLS);
  rows = constrain(Math.round(height / GRID_SPACING) + 1, 2, MAX_ROWS);
  const spacing = Math.min(width / (cols - 1), height / (rows - 1));
  // Even sizes, matching the 2px step of K/L and the size slider.
  shapeSize = constrain(Math.round((spacing * SHAPE_FILL) / 2) * 2, MIN_SHAPE_SIZE, MAX_SHAPE_SIZE);
  viewScale = constrain(Math.min(width, height) / REFERENCE_SIZE, MIN_VIEW_SCALE, MAX_VIEW_SCALE);
}

function draw() {
  background(bgHue, bgSat, bgBri);
  // The help panel is a DOM overlay, so the grid keeps running behind it.
  updateCamera();
  setupLights();
  drawGrid();
}

function drawGrid() {
  const c = max(1, cols);
  const r = max(1, rows);

  const spacingX = c > 1 ? width / (c - 1) : 0;
  const spacingY = r > 1 ? height / (r - 1) : 0;
  const startX = -((c - 1) * spacingX) * 0.5;
  const startY = -((r - 1) * spacingY) * 0.5;

  // Per-frame values shared by every cell.
  const ms = millis();
  const rt = ms * 0.001 * 1.2;
  // Clamp dt so a stall (e.g. a tab switch) can't blow up the springs.
  const dt = Math.min(deltaTime / 1000, 1 / 30);
  updateCursor(dt);
  updateRipples(dt);
  ensureSprings(c * r);

  fill(objectHue, objectSat, 100);

  for (let j = 0; j < r; j++) {
    for (let i = 0; i < c; i++) {
      const x = startX + i * spacingX;
      const y = startY + j * spacingY;
      const idx = j * c + i;

      stepSpring(idx, x, y, dt);
      push();
      translate(x + offX[idx], y + offY[idx], offZ[idx]);
      applyWiggle(i, j, ms);
      if (rotating) {
        rotateY(rt + i * 0.1);
        rotateX(rt * 0.6 + j * 0.1);
      }
      drawShape3D(shapeSize);
      pop();
    }
  }
}

function drawShape3D(size) {
  if (currentShape === SHAPE_CUBE) {
    box(size);
  } else if (currentShape === SHAPE_SPHERE) {
    // Use per-call detail to avoid global state glitches on some browsers.
    sphere(size * 0.6, 24, 16);
  } else if (currentShape === SHAPE_PYRAMID) {
    scale(size);
    model(pyramidGeom);
  }
}

function applyWiggle(i, j, ms) {
  if (!wiggle) return;
  const t = ms * 0.002;
  const wigX = sin(t + i * 0.6) * 4;
  const wigY = sin(t * 1.1 + j * 0.6) * 4;
  const wigZ = sin(t * 1.3 + i * 0.5 + j * 0.5) * 6;
  translate(wigX, wigY, wigZ);
  rotateZ(wigZ * 0.03);
}

// Ease the effect's center toward the mouse and fade it in/out with presence.
function updateCursor(dt) {
  const mx = mouseX - width * 0.5;
  const my = mouseY - height * 0.5;
  if (mouseInside && cursorPresence < 0.01) {
    // Re-entering: start at the mouse instead of sweeping in from the old spot.
    cursorX = mx;
    cursorY = my;
  }
  const follow = 1 - Math.exp(-tune.cursorFollow * dt);
  cursorX += (mx - cursorX) * follow;
  cursorY += (my - cursorY) * follow;
  const active = mouseInside && millis() - lastMoveMs < tune.idleTimeout * 1000;
  if (active && idle) waking = true;
  idle = mouseInside && !active;
  let rate = tune.presenceFade;
  if (idle) rate = tune.idleFade;
  else if (waking) rate = tune.wakeFade;
  const fade = 1 - Math.exp(-rate * dt);
  cursorPresence += ((active ? 1 : 0) - cursorPresence) * fade;
  if (waking && (!active || cursorPresence > 0.98)) waking = false;
}

// A click lets go of the cursor bump: the push drops out (then fades back in at
// presenceFade) while a ring carries the motion outward and dies away. The
// springs smooth both, so nothing snaps.
function spawnRipple(x, y) {
  cursorPresence = 0;
  // Recover at presenceFade even if the click woke the cursor from idle.
  idle = false;
  waking = false;
  ripples.push({ x, y, age: 0, radius: 0, amp: 0 });
  if (ripples.length > MAX_RIPPLES) ripples.shift();
}

function updateRipples(dt) {
  if (ripples.length === 0) return;
  for (const rp of ripples) {
    rp.age += dt;
    const life = rp.age / tune.rippleLife;
    rp.radius = rp.age * tune.rippleSpeed * viewScale;
    rp.amp = life < 1 ? tune.rippleStrength * viewScale * (1 - life) * (1 - life) : 0;
  }
  ripples = ripples.filter((rp) => rp.amp > 0);
}

// (Re)allocate spring buffers when the cell count changes; cells restart at rest.
function ensureSprings(n) {
  if (n === springCount) return;
  springCount = n;
  offX = new Float32Array(n);
  offY = new Float32Array(n);
  offZ = new Float32Array(n);
  velX = new Float32Array(n);
  velY = new Float32Array(n);
  velZ = new Float32Array(n);
}

// Normalizes the radial push so its strongest ring (d = R/sqrt(5)) equals pushStrength.
const RADIAL_PEAK = (1 / Math.sqrt(5)) * Math.pow(1 - 1 / 5, 2);

// Advance one cell's damped spring toward its displacement target.
function stepSpring(idx, x, y, dt) {
  let tx = 0;
  let ty = 0;
  let tz = 0;
  const dx = x - cursorX;
  const dy = y - cursorY;
  const R = tune.pushRadius * viewScale;
  const q = (dx * dx + dy * dy) / (R * R);
  if (q < 1 && cursorPresence > 0.001) {
    // (1 - q)^2 falls off smoothly and reaches exactly zero at pushRadius, so
    // there is no visible edge. Scaling the push by dx / R (rather than the unit
    // direction) zeroes it at the center and peaks in a ring around the cursor.
    const w = (1 - q) * (1 - q) * cursorPresence;
    const radial = ((tune.pushStrength * viewScale) / (RADIAL_PEAK * R)) * w;
    tx = dx * radial;
    ty = dy * radial;
    tz = tune.pushLift * viewScale * w;
  }

  const rippleWidth = tune.rippleWidth * viewScale;
  for (let n = 0; n < ripples.length; n++) {
    const rp = ripples[n];
    const rx = x - rp.x;
    const ry = y - rp.y;
    const d = Math.sqrt(rx * rx + ry * ry);
    const u = (d - rp.radius) / rippleWidth;
    if (u <= -1 || u >= 1) continue;
    // A crest with shallow troughs on each side. The profile is zero at |u| = 1,
    // so the ring has no hard edge.
    const s = 1 - u * u;
    const h = rp.amp * s * s * Math.cos(Math.PI * u);
    tz += h;
    if (d > 0.001) {
      const k = (h * RIPPLE_SPREAD) / d;
      tx += rx * k;
      ty += ry * k;
    }
  }

  // Semi-implicit Euler: stable for the slider ranges in panel.js with dt <= 1/30.
  const k = tune.springStiffness;
  const c = tune.springDamping;
  velX[idx] += (k * (tx - offX[idx]) - c * velX[idx]) * dt;
  velY[idx] += (k * (ty - offY[idx]) - c * velY[idx]) * dt;
  velZ[idx] += (k * (tz - offZ[idx]) - c * velZ[idx]) * dt;
  offX[idx] += velX[idx] * dt;
  offY[idx] += velY[idx] * dt;
  offZ[idx] += velZ[idx] * dt;
}

// Adapted from learningprocessing.com pyramid tutorial.
function drawPyramid(size) {
  const h = size * 0.8;
  const half = size * 0.5;
  const yTop = -h * 0.5;
  const yBase = h * 0.5;

  beginShape(TRIANGLES);
  vertex(-half, yBase, -half);
  vertex(half, yBase, -half);
  vertex(half, yBase, half);

  vertex(-half, yBase, -half);
  vertex(half, yBase, half);
  vertex(-half, yBase, half);
  endShape();

  beginShape(TRIANGLES);
  vertex(-half, yBase, half);
  vertex(half, yBase, half);
  vertex(0, yTop, 0);

  vertex(half, yBase, half);
  vertex(half, yBase, -half);
  vertex(0, yTop, 0);

  vertex(half, yBase, -half);
  vertex(-half, yBase, -half);
  vertex(0, yTop, 0);

  vertex(-half, yBase, -half);
  vertex(-half, yBase, half);
  vertex(0, yTop, 0);
  endShape();
}

function setupLights() {
  ambientLight(0, 0, 40);
  directionalLight(40, 10, 80, -0.4, -0.6, 0.7);
  pointLight(0, 0, 100, 0, 0, 0);
}

// Cheap enough to re-apply every frame, which also covers resizeCanvas()
// resetting the projection.
function updateCamera() {
  camera(0, 0, camZ, 0, 0, 0, 0, 1, 0);
  perspective(FOV, width / height, 1, camZ * 4);
}

// p5.js global event hooks
function keyPressed() {
  if (controls) {
    controls.keyPressed();
    helpPanel.syncState();
  }
}

function keyReleased() {
  if (controls) {
    controls.keyReleased();
  }
}

// Only for C/B color picking; the push uses the canvas pointer listeners in setup().
function mouseMoved() {
  if (controls) {
    controls.mouseMoved();
  }
}

function mouseDragged() {
  mouseMoved();
}

function saveImage() {
  saveCanvas("matrix-" + nf(frameCount, 4), "png");
}

function updateColorsFromMouse() {
  const h = map(mouseX, 0, width, 0, 360);
  const s = map(mouseY, 0, height, 0, 100);
  if (cHeld) {
    objectHue = h;
    objectSat = s;
  }
  if (bHeld) {
    bgHue = h;
    bgSat = s;
  }
}

// Helper classes translated to JavaScript
class Controls {
  keyPressed() {
    // While a panel slider has focus, the arrow keys nudge it instead.
    const sliderFocused = document.activeElement && document.activeElement.tagName === "INPUT";
    if (!sliderFocused) {
      if (keyCode === LEFT_ARROW) {
        cols = max(1, cols - 1);
      } else if (keyCode === RIGHT_ARROW) {
        cols = min(MAX_COLS, cols + 1);
      } else if (keyCode === UP_ARROW) {
        rows = min(MAX_ROWS, rows + 1);
      } else if (keyCode === DOWN_ARROW) {
        rows = max(1, rows - 1);
      }
    }

    const k = typeof key === "string" ? key.toLowerCase() : "";
    if (keyCode === ESCAPE) {
      if (showHelp) setHelp(false);
    } else if (k === "h") {
      setHelp(!showHelp);
    } else if (k === "s") {
      currentShape = (currentShape + 1) % 3;
    } else if (k === "r") {
      rotating = !rotating;
    } else if (k === "w") {
      wiggle = !wiggle;
    } else if (k === "f") {
      toggleFullscreen();
    } else if (k === "p") {
      saveImage();
    } else if (k === "l") {
      shapeSize = min(MAX_SHAPE_SIZE, shapeSize + 2);
    } else if (k === "k") {
      shapeSize = max(MIN_SHAPE_SIZE, shapeSize - 2);
    } else if (k === "c") {
      cHeld = true;
      updateColorsFromMouse();
    } else if (k === "b") {
      bHeld = true;
      updateColorsFromMouse();
    }
  }

  keyReleased() {
    const k = typeof key === "string" ? key.toLowerCase() : "";
    if (k === "c") {
      cHeld = false;
    } else if (k === "b") {
      bHeld = false;
    }
  }

  mouseMoved() {
    if (cHeld || bHeld) {
      updateColorsFromMouse();
      helpPanel.syncState();
    }
  }
}
