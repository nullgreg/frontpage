// Small DOM helpers shared by the page's widgets.

const SVG = "http://www.w3.org/2000/svg";

/** An inline <svg class="icon"> showing the sprite symbol `#id`. */
export function icon(id) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}
