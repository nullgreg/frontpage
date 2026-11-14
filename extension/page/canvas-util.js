// Small drawing and number helpers shared by the canvas scenes.

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** A random number from min to max. */
export const between = (min, max) => min + Math.random() * (max - min);

/** Moves each item's `x` and `y` by the factors a canvas resize changed them by. */
export function scalePoints(items, sx, sy) {
  for (const item of items) {
    item.x *= sx;
    item.y *= sy;
  }
}

/** Linear interpolation of two [r, g, b] triples by t (0..1). */
export function mixRgb(a, b, t) {
  return a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));
}

/** "#rrggbb" -> [r, g, b]. */
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Eases `state[key]` toward `target` over a few seconds, so a weather update
 * never makes a scene snap. A still frame (dt 0) takes the target directly.
 */
export function ease(state, key, target, dt) {
  state[key] = dt === 0 ? target : state[key] + (target - state[key]) * Math.min(1, dt * 0.5);
  return state[key];
}

export function fillVertical(ctx, w, h, stops) {
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  stops.forEach(([at, color]) => gradient.addColorStop(at, color));
  ctx.globalAlpha = 1;
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

/** A soft radial glow of `color` at (x, y), fading out at `radius`. */
export function fillGlow(ctx, x, y, radius, color) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "transparent");
  ctx.fillStyle = gradient;
  // Only the glow's square: outside the radius the gradient is transparent anyway.
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}
