// The "Sky" background: the sky as it is now in the weather city. Time of day
// sets the gradient, the sun or moon crosses an arc, stars show at night and
// cloud cover drifts across. Rain, snow, fog and lightning are not drawn here;
// they come from the weather layer, which stays on for this style.
//
// The day sky is deliberately dark: the page's light text sits straight on it.
import { between, clamp, ease, fillGlow, hexToRgb, mixRgb, scalePoints } from "./canvas-util.js";

const rgb = ([r, g, b], a) => `rgb(${r} ${g} ${b} / ${a})`;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// What Sky shows with no city or no fresh reading.
const FAIR = { kind: "clear", cloud: 0.1, wind: 12, sunrise: 0, sunset: 0 };
const WET = new Set(["fog", "drizzle", "rain", "snow", "storm"]);

const smoothstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Where the day is at `now` (epoch ms) given today's `sunrise` and `sunset`
 * (epoch ms, 0 when unknown). Returns { day, twilight, sun, moon }, all 0..1:
 * `day` is daylight (soft over the hour centred on sunrise and on sunset),
 * `twilight` peaks at those two moments, `sun` and `moon` are how far each is
 * along its arc.
 */
export function skyTime(now, sunrise, sunset) {
  let rise = sunrise;
  let set = sunset;
  if (!rise || !set || set <= rise) {
    const today = new Date(now);
    rise = today.setHours(6, 30, 0, 0);
    set = today.setHours(18, 30, 0, 0);
  }

  // The service gives today's times only, so yesterday's and tomorrow's are
  // taken 24 hours away. Each day's light is a soft-edged window; the windows
  // never overlap, so the brightest of the three is the one in force.
  const up = (edge) => smoothstep((now - edge) / HOUR + 0.5);
  let day = 0;
  let nearest = Infinity;
  for (const k of [-1, 0, 1]) {
    day = Math.max(day, up(rise + k * DAY) * (1 - up(set + k * DAY)));
    nearest = Math.min(nearest, Math.abs(now - (rise + k * DAY)), Math.abs(now - (set + k * DAY)));
  }
  const twilight = Math.max(0, 1 - nearest / (50 * 60 * 1000));

  // The moon follows the nearest night: last night's, which began at
  // yesterday's sunset, until midday, then tonight's. Clamping puts it at the
  // end of its arc through the morning and the start through the afternoon,
  // so it never sits on the sun and the switch happens while it is invisible.
  const lastNight = now < rise + (set - rise) / 2;
  const nightStart = lastNight ? set - DAY : set;
  const nightEnd = lastNight ? rise : rise + DAY;
  const moon = (now - nightStart) / (nightEnd - nightStart);
  const sun = (now - rise) / (set - rise);
  return { day, twilight, sun: clamp(sun, 0, 1), moon: clamp(moon, 0, 1) };
}

// Gradient stops at 0, 0.55 and 1.
const NIGHT = ["#04050d", "#0a0f26", "#151b3c"].map(hexToRgb);
const DAYTIME = ["#0a2850", "#144272", "#1f5584"].map(hexToRgb);
const TWILIGHT_MIDDLE = hexToRgb("#3a2a5c");
const TWILIGHT_BOTTOM = hexToRgb("#9a4a3a");
const GREY_NIGHT = hexToRgb("#0d1018");
const GREY_DAY = hexToRgb("#252c38");
const SNOW_TINT = hexToRgb("#3a4658");
const FOG_TINT = hexToRgb("#2c3440");

/** The three sky colours for this moment and weather, as [r, g, b]. */
export function skyStops(day, twilight, cloud, kind) {
  const stops = NIGHT.map((night, i) => mixRgb(night, DAYTIME[i], day));
  stops[1] = mixRgb(stops[1], TWILIGHT_MIDDLE, 0.7 * twilight);
  stops[2] = mixRgb(stops[2], TWILIGHT_BOTTOM, 0.8 * twilight);
  const grey = mixRgb(GREY_NIGHT, GREY_DAY, day);
  return stops.map((stop) => {
    const clouded = mixRgb(stop, grey, 0.7 * cloud);
    if (kind === "drizzle" || kind === "rain") return clouded.map((c) => Math.round(c * 0.8));
    if (kind === "storm") return clouded.map((c) => Math.round(c * 0.6));
    if (kind === "snow") return mixRgb(clouded, SNOW_TINT, 0.3);
    if (kind === "fog") return mixRgb(clouded, FOG_TINT, 0.5);
    return clouded;
  });
}

const CLOUDS = 7;
const CLOUD_MARGIN = 220; // wider than any cloud, so wrapping never pops

const CLOUD_NIGHT = [120, 130, 165];
const CLOUD_DAY = [205, 218, 236];
const CLOUD_WET = [125, 135, 155];

// Soft radial glow at (x, y): a sun, a moon halo, a cloud puff.
function glow(ctx, x, y, radius, colour, alpha) {
  if (alpha > 0) fillGlow(ctx, x, y, radius, rgb(colour, alpha));
}

// Position along the arc the sun and moon share, from the lower left to the
// lower right by way of the upper middle.
const arc = (w, h, f) => [w * (0.12 + 0.76 * f), h * (0.78 - 0.62 * Math.sin(Math.PI * f))];

export const sky = {
  refreshMs: 60000, // keeps the sun moving with animation off

  init(w, h, env) {
    const conditions = env.conditions ?? FAIR;
    const count = Math.min(320, Math.round((w * h) / 6500));
    return {
      cloud: conditions.cloud,
      wind: conditions.wind,
      stars: Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        size: between(0.5, 1.4),
        phase: Math.random() * Math.PI * 2,
        rate: between(0.4, 2),
        rank: Math.random(), // which stars the cloud hides first
      })),
      // The first round(cloud * 7) clouds show.
      clouds: Array.from({ length: CLOUDS }, () => {
        const scale = between(0.7, 1.6);
        return {
          x: between(-CLOUD_MARGIN, w + CLOUD_MARGIN),
          y: between(0.08, 0.55) * h,
          scale,
          speed: between(0.6, 1.2),
          puffs: Array.from({ length: 5 }, () => ({
            dx: between(-60, 60) * scale,
            dy: between(-12, 12) * scale,
            radius: between(38, 70) * scale,
          })),
        };
      }),
    };
  },

  resize(state, sx, sy) {
    scalePoints(state.stars, sx, sy);
    scalePoints(state.clouds, sx, sy);
  },

  draw(ctx, w, h, state, t, dt, env) {
    const conditions = env.conditions ?? FAIR;
    const { kind } = conditions;
    const cloud = ease(state, "cloud", conditions.cloud, dt);
    const wind = ease(state, "wind", conditions.wind, dt);
    const { day, twilight, sun, moon } = skyTime(Date.now(), conditions.sunrise, conditions.sunset);

    const stops = skyStops(day, twilight, cloud, kind);
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    [0, 0.55, 1].forEach((at, i) => gradient.addColorStop(at, rgb(stops[i], 1)));
    ctx.globalAlpha = 1;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Stars fade with daylight and thin out under cloud. They do not drift.
    const starDim = (1 - day) * (1 - 0.4 * cloud);
    if (starDim > 0.01) {
      ctx.fillStyle = "#ffffff";
      for (const star of state.stars) {
        if (star.rank < cloud * 0.9) continue;
        const twinkle = 0.5 + 0.5 * Math.sin(t * star.rate + star.phase);
        ctx.globalAlpha = (0.35 + 0.65 * twinkle) * starDim;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Sun and moon: hidden by cloud, and further by anything falling.
    const veiled = (1 - 0.85 * cloud) * (WET.has(kind) ? 0.3 : 1);
    const sunAlpha = day * veiled;
    if (sunAlpha > 0.005) {
      const [x, y] = arc(w, h, sun);
      const colour = sun < 0.12 || sun > 0.88 ? [255, 170, 110] : [255, 236, 190];
      glow(ctx, x, y, 320, colour, 0.14 * sunAlpha);
      glow(ctx, x, y, 70, colour, 0.5 * sunAlpha);
    }
    const moonAlpha = (1 - day) * veiled;
    if (moonAlpha > 0.005) {
      const [x, y] = arc(w, h, moon);
      glow(ctx, x, y, 120, [225, 232, 255], 0.12 * moonAlpha);
      ctx.globalAlpha = 0.9 * moonAlpha;
      ctx.fillStyle = "rgb(225 232 255)";
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Clouds drift right with the wind and wrap out of sight.
    const wet = kind === "drizzle" || kind === "rain" || kind === "storm";
    const cloudColour = wet ? CLOUD_WET : mixRgb(CLOUD_NIGHT, CLOUD_DAY, day);
    const cloudAlpha = wet ? 0.12 : 0.08 + 0.03 * day;
    const active = Math.round(cloud * CLOUDS);
    state.clouds.forEach((item, i) => {
      item.x += (4 + wind * 0.6) * item.speed * dt;
      if (item.x > w + CLOUD_MARGIN) item.x -= w + CLOUD_MARGIN * 2;
      if (i >= active) return;
      for (const puff of item.puffs) glow(ctx, item.x + puff.dx, item.y + puff.dy, puff.radius, cloudColour, cloudAlpha);
    });
    if (cloud > 0.85) {
      ctx.fillStyle = "rgb(110 120 140 / 0.08)";
      ctx.fillRect(0, 0, w, h);
    }
  },
};
