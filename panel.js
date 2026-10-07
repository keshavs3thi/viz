// Help panel: a DOM overlay (markup and styles in index.html) listing the key
// bindings, with live sliders for the keyboard-driven state (stateSliders) and
// for every value in `tune` (TUNE_SLIDERS), both in sketch.js.

// Sliders for state the keys (and C/B + mouse) also change. Built on demand
// because sketch.js, which declares these globals, loads after this file.
function stateSliders() {
  return {
    color: [
      { label: "Shape hue", keys: ["C"], axis: "↔", min: 0, max: 360, step: 1, unit: "°", get: () => objectHue, set: (v) => (objectHue = v) },
      { label: "Shape saturation", keys: ["C"], axis: "↕", min: 0, max: 100, step: 1, unit: "%", get: () => objectSat, set: (v) => (objectSat = v) },
      { label: "Background hue", keys: ["B"], axis: "↔", min: 0, max: 360, step: 1, unit: "°", get: () => bgHue, set: (v) => (bgHue = v) },
      { label: "Background saturation", keys: ["B"], axis: "↕", min: 0, max: 100, step: 1, unit: "%", get: () => bgSat, set: (v) => (bgSat = v) },
    ],
    shape: [
      { label: "Size", keys: ["K", "L"], min: MIN_SHAPE_SIZE, max: MAX_SHAPE_SIZE, step: 2, unit: "px", get: () => shapeSize, set: (v) => (shapeSize = v) },
    ],
    grid: [
      { label: "Columns", keys: ["←", "→"], min: 1, max: MAX_COLS, step: 1, get: () => cols, set: (v) => (cols = v) },
      { label: "Rows", keys: ["↓", "↑"], min: 1, max: MAX_ROWS, step: 1, get: () => rows, set: (v) => (rows = v) },
    ],
  };
}

const TUNE_SLIDERS = [
  {
    title: "Cursor",
    items: [
      { key: "pushRadius", label: "Radius", min: 40, max: 400, step: 5, unit: "px" },
      { key: "pushStrength", label: "Push", min: 0, max: 80, step: 1, unit: "px" },
      { key: "pushLift", label: "Lift", min: 0, max: 150, step: 1, unit: "px" },
      { key: "cursorFollow", label: "Follow speed", min: 1, max: 40, step: 0.5, unit: "/s" },
      { key: "presenceFade", label: "Fade speed", min: 1, max: 30, step: 0.5, unit: "/s" },
    ],
  },
  {
    title: "Spring",
    // Ranges keep semi-implicit Euler stable at dt = 1/30 (k*dt^2 + 2*c*dt < 4).
    items: [
      { key: "springStiffness", label: "Stiffness", min: 20, max: 600, step: 5 },
      { key: "springDamping", label: "Damping", min: 1, max: 40, step: 0.5 },
    ],
  },
  {
    title: "Click ripple",
    items: [
      { key: "rippleStrength", label: "Strength", min: 0, max: 100, step: 1, unit: "px" },
      { key: "rippleSpeed", label: "Speed", min: 100, max: 1500, step: 10, unit: "px/s" },
      { key: "rippleWidth", label: "Width", min: 20, max: 240, step: 5, unit: "px" },
      { key: "rippleLife", label: "Duration", min: 0.3, max: 3, step: 0.1, unit: "s" },
    ],
  },
  {
    title: "Idle",
    items: [
      { key: "idleTimeout", label: "Timeout", min: 0.5, max: 10, step: 0.5, unit: "s" },
      { key: "idleFade", label: "Fade out speed", min: 0.1, max: 4, step: 0.1, unit: "/s" },
      { key: "wakeFade", label: "Wake speed", min: 2, max: 40, step: 1, unit: "/s" },
    ],
  },
];

function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

// Fullscreen covers the whole page (not just the canvas) so the panel and
// buttons stay usable. The button is removed where the API is missing (e.g.
// iPhone Safari); webkit-prefixed names cover older Safari.
function fullscreenSupported() {
  const el = document.documentElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function toggleFullscreen() {
  if (!fullscreenSupported()) return;
  let result;
  if (isFullscreen()) {
    result = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    const el = document.documentElement;
    result = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  }
  if (result && result.catch) result.catch(() => {}); // e.g. denied by the browser
}

// px around the corner buttons where the system cursor shows and the push is off.
const CORNER_MARGIN = 40;

// localStorage flag: once the nudge is dismissed or the panel opened, it never returns.
const NUDGE_KEY = "3dviz-nudge-dismissed";
const NUDGE_DELAY_MS = 1200;
// localStorage flag: remembers whether "Advanced motion" was left open.
const ADVANCED_KEY = "3dviz-advanced-open";
// localStorage flag: the touch-only "best on a computer" banner was dismissed.
const BANNER_KEY = "3dviz-desktop-banner-dismissed";
const BANNER_DELAY_MS = 600;
const IS_TOUCH = matchMedia("(hover: none) and (pointer: coarse)").matches;
// Same breakpoint as the bottom-sheet CSS in index.html.
const SHEET_QUERY = matchMedia("(max-width: 600px)");
// Bottom sheet swipe: px dragged, or px/ms flick speed, that dismisses it.
const SHEET_CLOSE_DISTANCE = 100;
const SHEET_CLOSE_VELOCITY = 0.5;

// Storage can be unavailable or throw (private windows, blocked site data);
// then the nudge just behaves per page load.
function readFlag(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch (e) {
    return false;
  }
}

function writeFlag(key, on = true) {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch (e) {}
}

class HelpPanel {
  constructor() {
    this.el = document.getElementById("help");
    this.corner = document.getElementById("corner");
    this.button = document.getElementById("help-button");
    this.nudge = document.getElementById("nudge");
    this.tuneSliders = []; // { input, output, spec } per slider
    this.stateSliders = [];
    this.stateControls = []; // sync functions for the shape picker and switches
    const state = stateSliders();
    for (const name in state) {
      const root = this.el.querySelector(`[data-sliders="${name}"]`);
      for (const spec of state[name]) this.stateSliders.push(this.addSlider(root, spec));
    }
    this.buildTuneSliders(document.getElementById("tuning"));
    this.setupStateControls();

    const advanced = this.el.querySelector(".advanced");
    advanced.open = readFlag(ADVANCED_KEY);
    advanced.addEventListener("toggle", () => writeFlag(ADVANCED_KEY, advanced.open));

    this.button.addEventListener("click", () => setHelp(true));
    this.setupFullscreenButton(document.getElementById("fullscreen-button"));
    this.el.querySelector("[data-close]").addEventListener("click", () => setHelp(false));
    this.el.querySelector("[data-reset]").addEventListener("click", () => this.reset());
    const copy = this.el.querySelector("[data-copy]");
    copy.addEventListener("click", () => this.copy(copy));

    this.setupSheetSwipe();
    this.setupBanner();

    this.nudge.querySelector("[data-dismiss]").addEventListener("click", () => this.dismissNudge());
    if (!readFlag(NUDGE_KEY)) {
      setTimeout(() => {
        if (!readFlag(NUDGE_KEY)) this.nudge.classList.add("show");
      }, NUDGE_DELAY_MS);
    }
  }

  // Is (x, y) within CORNER_MARGIN px of the visible corner items (buttons, plus
  // the nudge while it shows)? Always false while the group is hidden.
  nearCorner(x, y) {
    if (this.corner.classList.contains("hidden")) return false;
    for (const item of this.corner.children) {
      if (item === this.nudge && !this.nudge.classList.contains("show")) continue;
      const r = item.getBoundingClientRect();
      if (
        x > r.left - CORNER_MARGIN &&
        x < r.right + CORNER_MARGIN &&
        y > r.top - CORNER_MARGIN &&
        y < r.bottom + CORNER_MARGIN
      ) {
        return true;
      }
    }
    return false;
  }

  // Shape picker, Rotation/Wiggle switches, and Save, for the S/R/W/P keys.
  setupStateControls() {
    const shapeButtons = [...this.el.querySelectorAll("[data-shape] button")];
    for (const b of shapeButtons) {
      b.addEventListener("click", () => {
        currentShape = Number(b.dataset.value);
        this.syncState();
      });
    }
    this.stateControls.push(() => {
      for (const b of shapeButtons) b.setAttribute("aria-pressed", String(Number(b.dataset.value) === currentShape));
    });

    const toggles = {
      rotating: [() => rotating, (v) => (rotating = v)],
      wiggle: [() => wiggle, (v) => (wiggle = v)],
    };
    for (const el of this.el.querySelectorAll("[data-switch]")) {
      const [get, set] = toggles[el.dataset.switch];
      el.addEventListener("click", () => {
        set(!get());
        this.syncState();
      });
      this.stateControls.push(() => el.setAttribute("aria-checked", String(get())));
    }

    this.el.querySelector("[data-save]").addEventListener("click", saveImage);
    this.syncState();
  }

  setupFullscreenButton(button) {
    const row = this.el.querySelector("[data-fullscreen-row]");
    const toggle = row.querySelector("[data-fullscreen-switch]");
    if (!fullscreenSupported()) {
      button.remove();
      row.remove();
      return;
    }
    button.addEventListener("click", toggleFullscreen);
    toggle.addEventListener("click", toggleFullscreen);
    const update = () => {
      const on = isFullscreen();
      button.classList.toggle("active", on);
      button.setAttribute("aria-label", on ? "Exit full screen (F)" : "Enter full screen (F)");
      toggle.setAttribute("aria-checked", String(on));
    };
    update();
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
  }

  // Phones: drag the bottom sheet down to dismiss it, from the grabber or header,
  // or from anywhere once its content is scrolled to the top. Sliders are left
  // alone so dragging them never moves the sheet.
  setupSheetSwipe() {
    const el = this.el;
    let startY = 0;
    let startT = 0;
    let dy = 0;
    let tracking = false;
    let dragging = false;

    el.addEventListener(
      "touchstart",
      (e) => {
        tracking =
          SHEET_QUERY.matches &&
          e.touches.length === 1 &&
          el.scrollTop <= 0 &&
          !e.target.closest('input[type="range"]');
        dragging = false;
        dy = 0;
        startY = e.touches[0].clientY;
        startT = e.timeStamp;
      },
      { passive: true }
    );

    el.addEventListener(
      "touchmove",
      (e) => {
        if (!tracking) return;
        dy = e.touches[0].clientY - startY;
        if (!dragging) {
          if (dy < -4) {
            tracking = false; // scrolling the content up; let it scroll
            return;
          }
          if (dy < 8) return;
          dragging = true;
          el.style.transition = "none";
        }
        e.preventDefault();
        el.style.transform = `translateY(${Math.max(0, dy)}px)`;
      },
      { passive: false }
    );

    const end = (e) => {
      tracking = false;
      if (!dragging) return;
      dragging = false;
      const velocity = dy / Math.max(1, e.timeStamp - startT);
      if (dy > SHEET_CLOSE_DISTANCE || (dy > 30 && velocity > SHEET_CLOSE_VELOCITY)) {
        // Slide the rest of the way down, then hand back to the CSS closed state.
        el.style.transition = "transform 0.25s ease, opacity 0.25s ease";
        el.style.transform = "translateY(100%)";
        setHelp(false);
        setTimeout(() => {
          el.style.transition = "";
          el.style.transform = "";
        }, 300);
      } else {
        el.style.transition = "";
        el.style.transform = "";
      }
    };
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
  }

  setupBanner() {
    const banner = document.getElementById("desktop-banner");
    const setOffset = (px) => document.documentElement.style.setProperty("--banner-offset", px + "px");
    banner.querySelector("[data-banner-dismiss]").addEventListener("click", () => {
      banner.classList.remove("show");
      setOffset(0);
      writeFlag(BANNER_KEY);
    });
    if (!IS_TOUCH || readFlag(BANNER_KEY)) return;
    setTimeout(() => {
      banner.classList.add("show");
      setOffset(banner.offsetHeight + 8);
    }, BANNER_DELAY_MS);
  }

  dismissNudge() {
    this.nudge.classList.remove("show");
    writeFlag(NUDGE_KEY);
  }

  setOpen(open) {
    if (open) this.dismissNudge();
    this.el.classList.toggle("open", open);
    this.corner.classList.toggle("hidden", open);
    if (!open && this.el.contains(document.activeElement)) document.activeElement.blur();
  }

  buildTuneSliders(root) {
    for (const group of TUNE_SLIDERS) {
      const section = createEl("section");
      section.append(createEl("h2", null, group.title));
      for (const item of group.items) {
        const spec = { ...item, get: () => tune[item.key], set: (v) => (tune[item.key] = v) };
        this.tuneSliders.push(this.addSlider(section, spec));
      }
      root.append(section);
    }
  }

  // spec: { label, min, max, step, unit?, keys?, axis?, get, set }. keys are the
  // shortcut keycaps shown after the label; axis is the mouse direction while held.
  addSlider(root, spec) {
    const row = createEl("label", "slider");
    const head = createEl("span", "slider-head");
    const output = createEl("output");
    const label = createEl("span", null, spec.label);
    if (spec.keys) {
      const keys = createEl("span", "slider-keys");
      for (const k of spec.keys) keys.append(createEl("kbd", null, k));
      if (spec.axis) keys.append(createEl("span", "axis", spec.axis));
      label.append(keys);
    }
    head.append(label, output);

    const input = createEl("input");
    input.type = "range";
    input.min = spec.min;
    input.max = spec.max;
    input.step = spec.step;

    row.append(head, input);
    root.append(row);
    const slider = { input, output, spec };
    input.addEventListener("input", () => {
      spec.set(Number(input.value));
      this.sync(slider);
    });
    this.sync(slider);
    return slider;
  }

  // Push the slider's current value into it: thumb position, filled track, and readout.
  sync({ input, output, spec }) {
    const value = spec.get();
    input.value = value;
    const pct = Math.min(100, Math.max(0, ((value - spec.min) / (spec.max - spec.min)) * 100));
    input.style.setProperty("--p", pct + "%");
    const decimals = (String(spec.step).split(".")[1] || "").length;
    const unit = !spec.unit ? "" : spec.unit === "°" || spec.unit === "%" ? spec.unit : " " + spec.unit;
    output.textContent = value.toFixed(decimals) + unit;
  }

  // Call after keys or C/B color picking change state, so the controls follow.
  syncState() {
    for (const slider of this.stateSliders) this.sync(slider);
    for (const sync of this.stateControls) sync();
  }

  reset() {
    Object.assign(tune, TUNE_DEFAULTS);
    for (const slider of this.tuneSliders) this.sync(slider);
  }

  // Copy the current values as a drop-in replacement for `tune` in sketch.js.
  copy(button) {
    const body = Object.keys(tune)
      .map((k) => `  ${k}: ${tune[k]},`)
      .join("\n");
    const text = `const tune = {\n${body}\n};`;
    const write = navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject();
    write.then(
      () => {
        button.textContent = "Copied";
        setTimeout(() => (button.textContent = "Copy values"), 1200);
      },
      () => console.log(text) // no clipboard access (e.g. file://): log it instead
    );
  }
}
