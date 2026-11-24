/**
 * Small stroke icons built with DOM APIs (no markup strings). Text glyphs such as ‹ › × change
 * shape and size between fonts; these do not. Icons are decorative: the button carries the label.
 */
const PATHS = {
  previous: ['M10 3.5L5.5 8l4.5 4.5'],
  next: ['M6 3.5L10.5 8 6 12.5'],
  close: ['M4 4l8 8', 'M12 4l-8 8'],
  check: ['M3 8.5l3 3 7-7'],
  copy: ['M5.5 5.5h7v7h-7z', 'M3.5 10.5v-7h7'],
  search: ['M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z', 'M10.3 10.3L13.5 13.5'],
} as const;
export type IconName = keyof typeof PATHS;

const SVG = 'http://www.w3.org/2000/svg';
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG, 'path'); path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}
