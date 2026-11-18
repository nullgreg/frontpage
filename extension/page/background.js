// Page backgrounds. Four kinds:
//   glow   - three soft colour blobs drifting slowly (CSS animation)
//   canvas - a scene drawn on a <canvas>, capped at 30 fps
//   photo  - pictures from Wikimedia Commons and the Art Institute of Chicago (photos.js)
//   plain  - a still gradient
// With animation off (or "reduce motion" set in the OS) every style still
// shows, as a single still frame.
import { clamp, ease, fillVertical, fillGlow, hexToRgb, mixRgb, scalePoints } from "./canvas-util.js";
import { weatherLayer } from "./weather-layer.js";
import { sky, skyTime } from "./sky.js";
import { STALE } from "./weather.js";
import { createPhotoLayer } from "./photos.js";

// [saturation %, lightness %, alpha] of the three glow blobs.
const GLOW_BLOBS = [
  [90, 55, 0.5],
  [80, 55, 0.36],
  [80, 45, 0.3],
];

// Mood tint per weather kind: saturation and alpha multipliers, a lightness
// offset, and an optional small pull of the hue toward `hue` by `pull`. The
// pulls are tiny on purpose so every style keeps its identity.
const GLOW_TINTS = {
  clear: { s: 1.05, l: 0, a: 1.05 },
  partly: { s: 0.9, l: 0, a: 0.95 },
  overcast: { s: 0.5, l: -6, a: 0.8 },
  fog: { s: 0.35, l: 4, a: 0.7 },
  drizzle: { s: 0.75, l: -3, a: 0.9, hue: 215, pull: 0.08 },
  rain: { s: 0.65, l: -5, a: 0.9, hue: 215, pull: 0.15 },
  snow: { s: 0.45, l: 14, a: 0.9, hue: 205, pull: 0.12 },
  storm: { s: 0.7, l: -12, a: 0.85, hue: 270, pull: 0.18 },
};
const NO_TINT = { s: 1, l: 0, a: 1 };

// Short number for CSS: 94.5 -> "94.5", 90 -> "90", 0.525 -> "0.525".
const css = (n) => String(Number(n.toFixed(3)));

/**
 * The three blob colours for a glow style with the given hues, tinted by the
 * weather `conditions` (see weather.js) or untinted when they are null.
 * `lift` brightens the blobs: `l` is added to their lightness and `a`
 * multiplies their alpha (Daylight uses it to light up the day).
 */
export function tintGlow(hues, conditions, lift = { l: 0, a: 1 }) {
  const tint = GLOW_TINTS[conditions?.kind] ?? NO_TINT;
  const [c1, c2, c3] = GLOW_BLOBS.map(([s, l, a], i) => {
    const hue = tint.hue === undefined ? hues[i] : Math.round(mixHue(hues[i], tint.hue, tint.pull));
    const sat = clamp(s * tint.s, 0, 100);
    const light = clamp(l + tint.l + lift.l, 0, 100);
    const alpha = clamp(a * tint.a * lift.a, 0, 1);
    return `hsl(${hue} ${css(sat)}% ${css(light)}% / ${css(alpha)})`;
  });
  return { c1, c2, c3 };
}

const glowPreview = (base, h1, h2, h3) =>
  `radial-gradient(circle at 15% 10%, hsl(${h1} 90% 55% / 0.95), transparent 60%),
   radial-gradient(circle at 95% 45%, hsl(${h2} 80% 55% / 0.8), transparent 55%),
   radial-gradient(circle at 45% 120%, hsl(${h3} 80% 45% / 0.8), transparent 60%), ${base}`;

// ---------- "Daylight": a glow that follows the sun ----------
// The whole look moves with the day, not just the hues: the base brightens to
// a deep daytime blue, the blobs lift, and the vignette eases off. Like Sky,
// the day stays dark enough for the page's light text. Each palette: base
// gradient top and bottom, blob hues, blob lift (see tintGlow) and vignette alpha.
const DAYLIGHT = {
  night: { top: "#05070f", bottom: "#0d0f24", hues: [235, 268, 205], l: -4, a: 0.85, vignette: 0.6 },
  day: { top: "#0f3a6b", bottom: "#1c5a8f", hues: [195, 212, 178], l: 12, a: 1.25, vignette: 0.32 },
  dawn: { top: "#1b1840", bottom: "#4a2440", hues: [340, 22, 268], l: 6, a: 1.2, vignette: 0.45 },
  dusk: { top: "#1a1236", bottom: "#4d2228", hues: [18, 332, 42], l: 6, a: 1.2, vignette: 0.45 },
};
for (const palette of Object.values(DAYLIGHT)) {
  palette.top = hexToRgb(palette.top);
  palette.bottom = hexToRgb(palette.bottom);
}

function mixHue(a, b, t) {
  const delta = ((b - a + 540) % 360) - 180; // shortest way round the wheel
  return (a + delta * t + 360) % 360;
}

const mixNum = (a, b, t) => a + (b - a) * t;

function mixPalette(a, b, t) {
  return {
    top: mixRgb(a.top, b.top, t),
    bottom: mixRgb(a.bottom, b.bottom, t),
    hues: a.hues.map((hue, i) => mixHue(hue, b.hues[i], t)),
    l: mixNum(a.l, b.l, t),
    a: mixNum(a.a, b.a, t),
    vignette: mixNum(a.vignette, b.vignette, t),
  };
}

/**
 * Daylight's look at `now` (epoch ms). `conditions` supplies the city's
 * sunrise and sunset; without them skyTime falls back to 06:30 and 18:30.
 * Returns { base, hues, lift, vignette } for paint().
 */
export function daylightPalette(conditions, now = Date.now()) {
  const { day, twilight, sun } = skyTime(now, conditions?.sunrise ?? 0, conditions?.sunset ?? 0);
  // `sun` is 0 up to sunrise and 1 from sunset, so this picks the nearer edge.
  const edge = sun < 0.5 ? DAYLIGHT.dawn : DAYLIGHT.dusk;
  const p = mixPalette(mixPalette(DAYLIGHT.night, DAYLIGHT.day, day), edge, twilight);
  const rgbCss = ([r, g, b]) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
  return {
    base: `linear-gradient(180deg, ${rgbCss(p.top)}, ${rgbCss(p.bottom)})`,
    hues: p.hues.map(Math.round),
    lift: { l: p.l, a: p.a },
    vignette: css(p.vignette),
  };
}

// ---------- canvas scenes ----------
// Each scene: init(w, h, env) -> state, draw(ctx, w, h, state, seconds, deltaSeconds, env).
// `env.conditions` is the current weather (see weather.js) or null; scenes read
// it every frame, so a weather update never has to restart them. A scene with a
// numeric `refreshMs` is redrawn on that interval when it is not animating.
// A resize keeps the state too: a scene whose state holds positions gives
// resize(state, sx, sy) to stretch them by the change in width and height.

const STAR_TINTS = ["#ffffff", "#ffffff", "#cfe0ff", "#ffe9cf"];
const CLOUD_PATCHES = 5;

const starfield = {
  init(w, h, env) {
    const count = Math.min(520, Math.round((w * h) / 4200));
    return {
      shooting: null,
      cloud: env.conditions?.cloud ?? 0,
      stars: Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        depth: 0.2 + Math.random() ** 2 * 0.8,
        phase: Math.random() * Math.PI * 2,
        rate: 0.4 + Math.random() * 1.6,
        tint: STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)],
        rank: Math.random(), // which stars the cloud hides first
      })),
      // Soft patches of cloud; the first round(cloud * 5) of them show.
      patches: Array.from({ length: CLOUD_PATCHES }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        radius: 180 + Math.random() * 180,
        speed: 5 + Math.random() * 6,
      })),
    };
  },
  resize(state, sx, sy) {
    scalePoints(state.stars, sx, sy);
    scalePoints(state.patches, sx, sy);
    state.shooting = null;
  },
  draw(ctx, w, h, state, t, dt, env) {
    fillVertical(ctx, w, h, [[0, "#04050d"], [0.6, "#0a0f26"], [1, "#1b1136"]]);
    fillGlow(ctx, w * 0.78, h * 0.25, Math.max(w, h) * 0.5, "hsl(265 80% 50% / 0.16)");
    fillGlow(ctx, w * 0.15, h * 0.85, Math.max(w, h) * 0.45, "hsl(205 90% 50% / 0.12)");

    const cloud = ease(state, "cloud", env.conditions?.cloud ?? 0, dt);
    const active = state.patches.slice(0, Math.round(cloud * CLOUD_PATCHES));
    for (const patch of state.patches) {
      patch.x -= patch.speed * dt;
      if (patch.x < -patch.radius) patch.x = w + patch.radius;
    }

    for (const star of state.stars) {
      star.x -= star.depth * 5 * dt;
      if (star.x < -2) star.x = w + 2;
      if (star.rank < cloud * 0.9) continue;
      const twinkle = 0.5 + 0.5 * Math.sin(t * star.rate + star.phase);
      let alpha = star.depth * (0.35 + 0.65 * twinkle) * (1 - 0.4 * cloud);
      for (const patch of active) {
        const distance = Math.hypot(star.x - patch.x, star.y - patch.y);
        alpha *= 1 - 0.85 * Math.max(0, 1 - distance / patch.radius);
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = star.tint;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.depth * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    for (const { x, y, radius } of active) fillGlow(ctx, x, y, radius, "rgb(150 160 190 / 0.07)");

    if (!state.shooting && cloud < 0.3 && Math.random() < dt * 0.07) {
      state.shooting = { x: Math.random() * w * 0.8, y: Math.random() * h * 0.4, age: 0 };
    }
    const shot = state.shooting;
    if (shot) {
      shot.age += dt;
      const life = 0.9;
      const headX = shot.x + shot.age * 620;
      const headY = shot.y + shot.age * 250;
      const trail = ctx.createLinearGradient(headX - 150, headY - 60, headX, headY);
      trail.addColorStop(0, "transparent");
      trail.addColorStop(1, "#ffffff");
      ctx.globalAlpha = Math.max(0, Math.sin((shot.age / life) * Math.PI)) * 0.9;
      ctx.strokeStyle = trail;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(headX - 150, headY - 60);
      ctx.lineTo(headX, headY);
      ctx.stroke();
      if (shot.age > life) state.shooting = null;
    }
    ctx.globalAlpha = 1;
  },
};

const WAVE_HUES = [222, 252, 282, 200, 174];

const NEUTRAL_WIND = 12; // km/h; reproduces the look the waves had before wind drove them

const waves = {
  // The phase is accumulated rather than read from the clock, so a change in
  // wind speeds the waves up without making them jump. It starts at random
  // so each new tab opens on a different wave shape.
  init: (_w, _h, env) => ({ phase: Math.random() * 1000, wind: env.conditions?.wind ?? NEUTRAL_WIND }),
  draw(ctx, w, h, state, _t, dt, env) {
    fillVertical(ctx, w, h, [[0, "#06070f"], [1, "#0c1024"]]);
    fillGlow(ctx, w * 0.2, 0, Math.max(w, h) * 0.6, "hsl(230 90% 55% / 0.2)");

    const wind = ease(state, "wind", env.conditions?.wind ?? NEUTRAL_WIND, dt);
    state.phase += dt * clamp(0.55 + wind / 26, 0.55, 2.6);
    const t = state.phase;
    const lift = clamp(0.8 + wind / 60, 0.8, 1.5);

    WAVE_HUES.forEach((hue, i) => {
      const baseline = h * (0.42 + 0.115 * i);
      const amplitude = (34 + 16 * i) * lift;
      const height = (x) =>
        baseline +
        Math.sin(x * 0.0022 * (1 + i * 0.15) + t * (0.1 + 0.035 * i) + i * 1.7) * amplitude +
        Math.sin(x * 0.0051 + t * 0.17 - i) * amplitude * 0.35;

      ctx.beginPath();
      ctx.moveTo(0, height(0));
      for (let x = 12; x <= w + 12; x += 12) ctx.lineTo(x, height(x));
      ctx.strokeStyle = `hsl(${hue} 90% 72% / 0.4)`;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.lineTo(w + 12, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, baseline - amplitude, 0, h);
      fill.addColorStop(0, `hsl(${hue} 85% 60% / 0.2)`);
      fill.addColorStop(1, `hsl(${hue} 85% 40% / 0.02)`);
      ctx.fillStyle = fill;
      ctx.fill();
    });
  },
};

const LINK_DISTANCE = 150;

const constellation = {
  init(w, h) {
    const count = Math.max(30, Math.min(110, Math.round((w * h) / 15000)));
    return Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 22,
      vy: (Math.random() - 0.5) * 22,
      size: 1 + Math.random() * 1.4,
    }));
  },
  resize: scalePoints,
  draw(ctx, w, h, points, _t, dt) {
    fillVertical(ctx, w, h, [[0, "#05070f"], [1, "#0a0d1c"]]);
    fillGlow(ctx, w * 0.1, h * 0.05, Math.max(w, h) * 0.65, "hsl(232 90% 55% / 0.24)");
    fillGlow(ctx, w * 0.95, h * 0.9, Math.max(w, h) * 0.5, "hsl(285 80% 55% / 0.14)");

    for (const point of points) {
      point.x = (point.x + point.vx * dt + w) % w;
      point.y = (point.y + point.vy * dt + h) % h;
    }
    ctx.strokeStyle = "#9db8ff";
    ctx.lineWidth = 1;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const distance = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        if (distance > LINK_DISTANCE) continue;
        ctx.globalAlpha = (1 - distance / LINK_DISTANCE) * 0.3;
        ctx.beginPath();
        ctx.moveTo(points[i].x, points[i].y);
        ctx.lineTo(points[j].x, points[j].y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "#c9d8ff";
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
};

// Swatch for Photos: a dusk sky over two ridges of hills.
const PHOTO_PREVIEW = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 100' preserveAspectRatio='none'>
<linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#1b3566'/>
<stop offset='.55' stop-color='#b4707a'/><stop offset='1' stop-color='#f0b27a'/></linearGradient>
<rect width='160' height='100' fill='url(#s)'/><circle cx='112' cy='52' r='9' fill='#ffe2b8'/>
<path d='M0 68 28 44 46 58 72 32 100 60 124 47 160 70V100H0Z' fill='#33304f'/>
<path d='M0 84 36 68 64 80 98 64 132 82 160 75V100H0Z' fill='#16172a'/></svg>`;

// ---------- catalogue ----------
export const BACKGROUNDS = [
  { id: "aurora", name: "Aurora", kind: "glow", base: "#0b0d17", hues: [225, 280, 175] },
  { id: "ember", name: "Ember", kind: "glow", base: "#110a0a", hues: [14, 338, 40] },
  { id: "lagoon", name: "Lagoon", kind: "glow", base: "#07100f", hues: [188, 158, 214] },
  {
    id: "daylight",
    name: "Daylight",
    kind: "glow",
    base: "#0b0c16",
    palette: daylightPalette,
    preview: "linear-gradient(100deg, #1c2470, #b04a78 30%, #2f86cf 55%, #d9722f 80%, #3b1f70)",
  },
  {
    id: "starfield",
    name: "Starfield",
    kind: "canvas",
    scene: starfield,
    preview: `radial-gradient(1.5px 1.5px at 18% 30%, #fff, transparent), radial-gradient(1px 1px at 42% 68%, #fff, transparent),
      radial-gradient(1.5px 1.5px at 66% 22%, #cfe0ff, transparent), radial-gradient(1px 1px at 84% 58%, #fff, transparent),
      radial-gradient(1px 1px at 30% 84%, #ffe9cf, transparent), linear-gradient(#04050d, #0a0f26 60%, #1b1136)`,
  },
  {
    id: "waves",
    name: "Waves",
    kind: "canvas",
    scene: waves,
    preview: `radial-gradient(120% 60% at 30% 118%, hsl(174 85% 50% / 0.55), transparent 70%),
      radial-gradient(120% 60% at 75% 100%, hsl(282 85% 60% / 0.5), transparent 70%),
      radial-gradient(120% 60% at 20% 82%, hsl(222 85% 60% / 0.5), transparent 70%), #080a18`,
  },
  {
    id: "constellation",
    name: "Constellation",
    kind: "canvas",
    scene: constellation,
    preview: `radial-gradient(2px 2px at 22% 34%, #c9d8ff, transparent), radial-gradient(2px 2px at 48% 62%, #c9d8ff, transparent),
      radial-gradient(2px 2px at 74% 30%, #c9d8ff, transparent), radial-gradient(2px 2px at 86% 74%, #c9d8ff, transparent),
      linear-gradient(28deg, transparent 49%, #9db8ff55 50%, transparent 51%),
      radial-gradient(circle at 10% 5%, hsl(232 90% 55% / 0.5), transparent 70%), #070912`,
  },
  {
    id: "sky",
    name: "Sky",
    kind: "canvas",
    scene: sky,
    preview: "radial-gradient(circle at 72% 34%, rgb(255 236 190 / 0.85), transparent 24%), linear-gradient(#0a2850, #1f5584)",
  },
  {
    id: "photos",
    name: "Photos",
    kind: "photo",
    // Shows until the first picture has loaded, and if none can be.
    base: "linear-gradient(160deg, #141829, #07080d 70%)",
    preview: `url("data:image/svg+xml,${encodeURIComponent(PHOTO_PREVIEW)}") center / cover`,
  },
  {
    id: "midnight",
    name: "Midnight",
    kind: "plain",
    base: "linear-gradient(160deg, #141829, #07080d 70%)",
  },
];

/** CSS background for a small preview swatch of the given style. */
export function previewOf(style) {
  if (style.preview) return style.preview;
  if (style.kind === "glow") return glowPreview(style.base, ...style.hues);
  return style.base;
}

// Styles that draw their own cloud, so the weather layer leaves out its haze.
const DRAWS_CLOUD = new Set(["starfield", "sky"]);

const CACHE_KEY = "frontpage.background";
const WEATHER_KEY = "frontpage.weather";
const FRAME_MS = 1000 / 30;
// rAF timestamps are rounded to whole milliseconds, so two 60 Hz frames can
// measure 33 ms. Without this slack such a frame would be skipped and the next
// drawn at 50 ms, an uneven cadence that shows as judder.
const FRAME_SLACK_MS = 2;

/** Runs a scene on the canvas. Returns { stop(), redraw() }; redraw draws one frame now. */
function runScene(canvas, scene, animate, env) {
  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let state = null;
  let frameId = 0;
  let timer = 0;
  let last = 0;

  function redraw() {
    if (state) scene.draw(ctx, width, height, state, performance.now() / 1000, 0, env);
  }

  // Keeps the scene's state across size changes (window resize, zoom, a
  // scrollbar coming and going), so nothing jumps or restarts.
  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const nextWidth = canvas.clientWidth;
    const nextHeight = canvas.clientHeight;
    if (!nextWidth || !nextHeight) return;
    canvas.width = Math.round(nextWidth * ratio);
    canvas.height = Math.round(nextHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (!state) state = scene.init(nextWidth, nextHeight, env);
    else scene.resize?.(state, nextWidth / width, nextHeight / height);
    width = nextWidth;
    height = nextHeight;
    redraw();
  }

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    if (!state || now - last < FRAME_MS - FRAME_SLACK_MS) return;
    const delta = Math.min(now - last, 100) / 1000;
    last = now;
    scene.draw(ctx, width, height, state, now / 1000, delta, env);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  if (animate) frameId = requestAnimationFrame(frame);
  else if (typeof scene.refreshMs === "number") timer = setInterval(redraw, scene.refreshMs);

  return {
    stop() {
      cancelAnimationFrame(frameId);
      clearInterval(timer);
      observer.disconnect();
    },
    redraw,
  };
}

/**
 * Controls the backdrop element. `set`, `setWeather` and `setPhotos` are cheap
 * to call repeatedly. `credit` is the Photos credit line, outside the backdrop
 * because it holds links and buttons; `onHidePhoto(id)` saves a picture
 * someone never wants to see again.
 */
export function initBackground(root, { credit, onHidePhoto } = {}) {
  const canvas = root.querySelector(".scene");
  const layerCanvas = root.querySelector(".weather-layer");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  // Shared with the running scene, which reads it every frame.
  const env = { conditions: null };
  const weather = { conditions: null, enabled: true };
  let current = null;
  let style = null;
  let moving = false;
  let scene = null; // runScene handle while a canvas style shows
  let stop = () => {};
  let layer = null; // runScene handle while the weather layer shows
  let layerKey = "";
  const photos = createPhotoLayer(root, { credit, onHide: onHidePhoto });

  // Paints a glow style's blob colours with the current tint. Serves `refresh`
  // and Daylight's clock timer, so both pick up the weather.
  function paint() {
    if (style?.kind !== "glow") return;
    if (style.palette) {
      // Sunrise and sunset are the city's clock, not a weather effect, so
      // Daylight reads them whatever the Weather effects switch says.
      const { base, hues, lift, vignette } = style.palette(weather.conditions);
      root.style.setProperty("--base", base);
      root.style.setProperty("--vignette", vignette);
      paintBlobs(hues, lift);
    } else {
      paintBlobs(style.hues);
    }
  }

  function paintBlobs(hues, lift) {
    for (const [name, value] of Object.entries(tintGlow(hues, env.conditions, lift))) {
      root.style.setProperty(`--${name}`, value);
    }
  }

  // Applies the weather to whatever is showing. Nothing here restarts a scene.
  function refresh() {
    // Sky always shows the weather; the other styles only when the switch is on.
    const effective = weather.enabled || style?.id === "sky" ? weather.conditions : null;
    env.conditions = effective;
    paint();
    // The weather layer is only restarted when what it draws would change;
    // wind and the like it reads from `env` as it goes.
    const haze = !DRAWS_CLOUD.has(style?.id);
    const key = effective ? [effective.kind, effective.intensity, moving, haze].join("|") : "";
    if (key !== layerKey) {
      layerKey = key;
      layer?.stop();
      layer = null;
      delete root.dataset.fx;
      const layerScene = effective && weatherLayer(effective, { moving, haze });
      if (layerScene) {
        root.dataset.fx = effective.kind; // shows the canvas before the scene measures it
        layer = runScene(layerCanvas, layerScene, moving, env);
      }
    }
    if (scene && !moving) scene.redraw();
    try {
      localStorage.setItem(WEATHER_KEY, JSON.stringify(weather));
    } catch {
      /* storage unavailable */
    }
  }

  function set(id, animate) {
    const next = BACKGROUNDS.find((item) => item.id === id) ?? BACKGROUNDS[0];
    const nextMoving = Boolean(animate) && !reducedMotion.matches;
    const key = `${next.id}:${nextMoving}`;
    if (key === current) {
      refresh();
      return;
    }
    current = key;
    style = next;
    moving = nextMoving;
    stop();
    stop = () => {};

    root.dataset.style = style.id;
    root.dataset.kind = style.kind;
    root.classList.toggle("still", !moving);
    root.style.setProperty("--base", style.base ?? "#07080d");
    root.style.removeProperty("--vignette");

    if (style.kind === "glow") {
      // The first paint happens in refresh() below. Daylight follows the clock.
      if (style.palette) {
        const timer = setInterval(paint, 60 * 1000);
        stop = () => clearInterval(timer);
      }
    } else if (style.kind === "canvas") {
      scene = runScene(canvas, style.scene, moving, env);
      stop = () => {
        scene.stop();
        scene = null;
      };
    } else if (style.kind === "photo") {
      photos.start(moving);
      stop = () => photos.stop();
    }

    // Remembered outside async storage so the next tab can paint it immediately.
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ id: style.id, animate: Boolean(animate) }));
    } catch {
      /* storage unavailable: the page just starts on the default look */
    }
    refresh();
  }

  /**
   * `conditions` is the object from weather.js or null; `enabled` is the Weather
   * effects setting. Passing `undefined` for `conditions` keeps the current ones,
   * so a settings change before the first reading arrives does not wipe the
   * remembered weather.
   */
  function setWeather(conditions, enabled) {
    if (conditions !== undefined) weather.conditions = conditions;
    weather.enabled = Boolean(enabled);
    refresh();
  }

  // Both caches are read before the first `set`, which would otherwise overwrite them.
  let remembered = {};
  let rememberedWeather = null;
  try {
    remembered = JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {};
  } catch {
    /* ignore a missing or corrupt cache */
  }
  try {
    rememberedWeather = JSON.parse(localStorage.getItem(WEATHER_KEY));
  } catch {
    /* ignore a missing or corrupt cache */
  }
  set(remembered.id, remembered.animate ?? true);
  const saved = rememberedWeather?.conditions;
  if (saved && Date.now() - saved.at <= STALE) setWeather(saved, rememberedWeather.enabled ?? true);

  /** `options` is { categories, refresh, hidden } from the settings. */
  const setPhotos = (options) => photos.configure(options);

  return { set, setWeather, setPhotos };
}
