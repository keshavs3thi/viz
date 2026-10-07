// Help panel: a DOM overlay (markup and styles in index.html) listing the key
// bindings, with a live slider for every value in `tune` (sketch.js).

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

// localStorage flag: once the nudge is dismissed or the panel opened, it never returns.
const NUDGE_KEY = "3dviz-nudge-dismissed";
const NUDGE_DELAY_MS = 1200;

// Storage can be unavailable or throw (private windows, blocked site data);
// then the nudge just behaves per page load.
function readFlag(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch (e) {
    return false;
  }
}

function writeFlag(key) {
  try {
    localStorage.setItem(key, "1");
  } catch (e) {}
}

class HelpPanel {
  constructor() {
    this.el = document.getElementById("help");
    this.button = document.getElementById("help-button");
    this.nudge = document.getElementById("nudge");
    this.sliders = {}; // key -> { input, output, spec }
    this.buildSliders(document.getElementById("tuning"));

    this.button.addEventListener("click", () => setHelp(true));
    this.el.querySelector("[data-close]").addEventListener("click", () => setHelp(false));
    this.el.querySelector("[data-reset]").addEventListener("click", () => this.reset());
    const copy = this.el.querySelector("[data-copy]");
    copy.addEventListener("click", () => this.copy(copy));

    this.nudge.querySelector("[data-dismiss]").addEventListener("click", () => this.dismissNudge());
    if (!readFlag(NUDGE_KEY)) {
      setTimeout(() => {
        if (!readFlag(NUDGE_KEY)) this.nudge.classList.add("show");
      }, NUDGE_DELAY_MS);
    }
  }

  dismissNudge() {
    this.nudge.classList.remove("show");
    writeFlag(NUDGE_KEY);
  }

  setOpen(open) {
    if (open) this.dismissNudge();
    this.el.classList.toggle("open", open);
    this.button.classList.toggle("hidden", open);
    if (!open && this.el.contains(document.activeElement)) document.activeElement.blur();
  }

  buildSliders(root) {
    for (const group of TUNE_SLIDERS) {
      const section = createEl("section");
      section.append(createEl("h2", null, group.title));
      for (const spec of group.items) {
        const row = createEl("label", "slider");
        const head = createEl("span", "slider-head");
        const output = createEl("output");
        head.append(createEl("span", null, spec.label), output);

        const input = createEl("input");
        input.type = "range";
        input.min = spec.min;
        input.max = spec.max;
        input.step = spec.step;
        input.addEventListener("input", () => {
          tune[spec.key] = Number(input.value);
          this.sync(spec.key);
        });

        row.append(head, input);
        section.append(row);
        this.sliders[spec.key] = { input, output, spec };
        this.sync(spec.key);
      }
      root.append(section);
    }
  }

  // Push tune[key] into its slider: thumb position, filled track, and readout.
  sync(key) {
    const { input, output, spec } = this.sliders[key];
    const value = tune[key];
    input.value = value;
    const pct = ((value - spec.min) / (spec.max - spec.min)) * 100;
    input.style.setProperty("--p", pct + "%");
    const decimals = (String(spec.step).split(".")[1] || "").length;
    output.textContent = value.toFixed(decimals) + (spec.unit ? " " + spec.unit : "");
  }

  reset() {
    Object.assign(tune, TUNE_DEFAULTS);
    for (const key in this.sliders) this.sync(key);
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
