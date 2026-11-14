// Weather drawn on a transparent canvas over any background style: rain and
// drizzle streaks, snowflakes, fog, a haze under cloud and, in storms, dim
// lightning. Everything here is faint on purpose; the page is for reading.
import { between, clamp, scalePoints } from "./canvas-util.js";

/**
 * Brightness of a lightning flash `e` seconds after it began: two dim pulses,
 * the second fainter, over half a second. These numbers are also a safety
 * limit for photosensitivity; keep them.
 */
export function flashAlpha(e) {
  if (e < 0.1) return 0.13 * (1 - e / 0.1);
  if (e < 0.16) return 0;
  if (e < 0.5) return 0.07 * (1 - (e - 0.16) / 0.34);
  return 0;
}

// Soft horizontal bands that drift sideways and wrap: fog, and the haze under
// cloud. `yMin` and `yMax` are the fractions of the height they are centred in.
function bands(count, colour, yMin, yMax) {
  return {
    init(w, h) {
      return Array.from({ length: count }, (_, i) => ({
        x: Math.random() * w,
        y: between(yMin, yMax) * h,
        rx: between(0.9, 1.4) * w * 0.5,
        ry: between(140, 260) / 2,
        vx: between(6, 14) * (i % 2 ? -1 : 1),
      }));
    },
    resize(state, sx, sy) {
      scalePoints(state, sx, sy);
      for (const band of state) band.rx *= sx;
    },
    draw(ctx, w, h, state, t, dt) {
      for (const band of state) {
        band.x += band.vx * dt;
        if (band.x > w + band.rx) band.x = -band.rx;
        if (band.x < -band.rx) band.x = w + band.rx;
        ctx.save();
        ctx.translate(band.x, band.y);
        ctx.scale(band.rx, band.ry);
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        glow.addColorStop(0, colour);
        glow.addColorStop(1, "transparent");
        ctx.fillStyle = glow;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      }
    },
  };
}

function veil(colour) {
  return {
    init: () => ({}),
    draw(ctx, w, h) {
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, w, h);
    },
  };
}

const fog = [veil("rgb(196 206 222 / 0.05)"), bands(5, "rgb(210 218 232 / 0.07)", 0.25, 0.95)];
const haze = [veil("rgb(120 130 150 / 0.05)"), bands(3, "rgb(130 140 160 / 0.05)", 0, 0.5)];

// Falling streaks for drizzle, rain and storm. Wind leans them to the right.
function streaks(conditions) {
  const drizzle = conditions.kind === "drizzle";
  const [lengthMin, lengthMax] = drizzle ? [6, 11] : [14, 26];
  const [speedMin, speedMax] = drizzle ? [420, 620] : [900, 1300];
  const heavy = conditions.intensity >= 1;
  const alpha = (drizzle ? 0.16 : 0.2) + (heavy ? 0.05 : 0);
  const slantOf = (env) => clamp((env.conditions?.wind ?? conditions.wind) / 50, 0, 0.6);

  return {
    init(w, h) {
      const count = Math.min(400, Math.round((conditions.intensity * w * h) / (drizzle ? 16000 : 9000)));
      return Array.from({ length: count }, () => {
        const length = between(lengthMin, lengthMax);
        const share = (length - lengthMin) / (lengthMax - lengthMin); // longer falls faster
        return { x: Math.random() * w, y: Math.random() * h, length, speed: speedMin + share * (speedMax - speedMin) };
      });
    },
    resize: scalePoints,
    draw(ctx, w, h, drops, t, dt, env) {
      const slant = slantOf(env);
      ctx.beginPath();
      for (const drop of drops) {
        drop.y += drop.speed * dt;
        drop.x += drop.speed * slant * dt;
        if (drop.y - drop.length > h) {
          drop.y = -drop.length - Math.random() * 40;
          drop.x = between(-h * slant, w);
        }
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x - drop.length * slant, drop.y - drop.length);
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "rgb(190 210 255)";
      ctx.lineWidth = heavy ? 1.3 : 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
  };
}

function flakes(conditions) {
  return {
    init(w, h) {
      const count = Math.min(350, Math.round((conditions.intensity * w * h) / 6500));
      return Array.from({ length: count }, () => {
        const radius = between(0.8, 2.6);
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          radius,
          speed: 22 + radius * 20,
          sway: between(8, 22),
          rate: between(0.4, 1.1),
          phase: Math.random() * Math.PI * 2,
          alpha: 0.35 + (0.45 * radius) / 2.6,
        };
      });
    },
    resize: scalePoints,
    draw(ctx, w, h, state, t, dt, env) {
      const drift = (env.conditions?.wind ?? conditions.wind) * 0.9;
      const margin = 24; // the widest sway, so flakes wrap out of sight
      ctx.fillStyle = "#ffffff";
      for (const flake of state) {
        flake.y += flake.speed * dt;
        flake.x += drift * dt;
        if (flake.y > h + flake.radius) flake.y = -flake.radius;
        if (flake.x > w + margin) flake.x = -margin;
        if (flake.x < -margin) flake.x = w + margin;
        ctx.globalAlpha = flake.alpha;
        ctx.beginPath();
        ctx.arc(flake.x + Math.sin(t * flake.rate + flake.phase) * flake.sway, flake.y, flake.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };
}

// Dim, infrequent flashes over the whole canvas. Keeps its own clock so a
// flash lasts the same whatever `t` the scene is handed.
const lightning = {
  init: () => ({ clock: 0, next: between(5, 15), began: -1 }),
  draw(ctx, w, h, state, t, dt) {
    state.clock += dt;
    if (state.began < 0 && state.clock >= state.next) {
      state.began = state.clock;
      state.next = state.clock + between(6, 18);
    }
    if (state.began < 0) return;
    const elapsed = state.clock - state.began;
    if (elapsed >= 0.5) {
      state.began = -1;
      return;
    }
    ctx.globalAlpha = flashAlpha(elapsed);
    ctx.fillStyle = "rgb(205 218 255)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  },
};

/**
 * The scene for the weather layer under `conditions` (see weather.js), or null
 * when there is nothing to draw. `moving` is false with animation off, when
 * nothing falls and nothing flashes. `haze` is false for styles that draw
 * their own cloud.
 */
export function weatherLayer(conditions, { moving, haze: withHaze }) {
  const kind = conditions?.kind;
  const parts = [];
  if (kind === "fog") parts.push(...fog);
  else if (["overcast", "drizzle", "rain", "snow", "storm"].includes(kind) && withHaze) parts.push(...haze);
  if (moving) {
    if (kind === "drizzle" || kind === "rain" || kind === "storm") parts.push(streaks(conditions));
    if (kind === "snow") parts.push(flakes(conditions));
    if (kind === "storm") parts.push(lightning);
  }
  if (!parts.length) return null;

  return {
    init: (w, h, env) => parts.map((part) => part.init(w, h, env)),
    resize: (states, sx, sy) => parts.forEach((part, i) => part.resize?.(states[i], sx, sy)),
    draw(ctx, w, h, states, t, dt, env) {
      ctx.clearRect(0, 0, w, h);
      parts.forEach((part, i) => part.draw(ctx, w, h, states[i], t, dt, env));
    },
  };
}
