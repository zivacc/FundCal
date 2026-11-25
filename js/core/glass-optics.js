// Inset of the optical aperture from the nominal control bounds, in local CSS pixels.
export const glassApertureInset = 2.55;

// feDisplacementMap reads a source pixel at P + scale * (RG - 0.5).
// Each map belongs to the padded filter box; the rounded aperture starts at outset.
export function createGlassField(width, height, radius, rim, scale, outset, magnification, density = 1) {
  const filterWidth = width + 2 * outset, filterHeight = height + 2 * outset;
  const resolution = Math.min(density, 256 / Math.max(filterWidth, filterHeight));
  const columns = Math.ceil(filterWidth * resolution), rows = Math.ceil(filterHeight * resolution);
  const refraction = new Uint8ClampedArray(rows * columns * 4);
  const dispersion = magnification > 1 ? new Uint8ClampedArray(refraction.length) : null;
  const curvature = 1 - 1 / magnification;
  // Spread the bend across several pixels even on the narrow 5px dock rim.
  const bevelWidth = Math.min(radius * .58, rim * 1.6, Math.max(8, rim));
  const prismWidth = bevelWidth - glassApertureInset;
  const deflection = Math.min(scale * .45, bevelWidth * .87);
  // Allow the encoded vectors to cover the central zoom as well as the edge bend.
  const range = dispersion ? 2 * (Math.max(filterWidth, filterHeight) * curvature / 2 + deflection + 3) : scale;
  for (let row = 0; row < rows; row += 1) {
    const y = (row + .5) * filterHeight / rows - outset;
    for (let col = 0; col < columns; col += 1) {
      const x = (col + .5) * filterWidth / columns - outset;
      const dx = x - Math.max(radius, Math.min(x, width - radius));
      const dy = y - Math.max(radius, Math.min(y, height - radius));
      const length = Math.hypot(dx, dy);
      const depth = radius - length;
      const nx = length ? dx / length : 0, ny = length ? dy / length : 0;
      const pixel = (row * columns + col) * 4;
      if (dispersion) {
        // Inverse magnification keeps the whole image in focus. At the rounded
        // caps the steeper curvature bends passing glyphs. The long, shallow
        // upper/lower bevel must not fold a second copy of a centered label.
        const t = bevelWidth > 0 ? Math.max(0, Math.min(1, depth / bevelWidth)) : 1;
        const shoulder = width > height * 1.35 ? .18 + .82 * Math.abs(nx) : 1;
        const bevel = (1 - t) ** 2 * (1 + 2 * t) * shoulder;
        refraction[pixel] = 255 * (.5 + ((width / 2 - x) * curvature - nx * deflection * bevel) / range);
        refraction[pixel + 1] = 255 * (.5 + ((height / 2 - y) * curvature - ny * deflection * bevel) / range);
        // B carries steering strength; smaller bevels allow proportionally less tilt.
        refraction[pixel + 2] = 255 * bevel * Math.min(1, rim * .08);
        // The color split rises and falls inside the bevel. The padded texture
        // and the outer seam remain neutral, including under interpolation.
        const u = prismWidth > 0 ? Math.max(0, Math.min(1, (depth - glassApertureInset) / prismWidth)) : 0;
        const spread = (4 * u * (1 - u)) ** 2 * shoulder;
        dispersion[pixel] = 255 * (.5 + nx * spread / 2);
        dispersion[pixel + 1] = 255 * (.5 + ny * spread / 2);
        dispersion[pixel + 3] = 255;
      } else {
        // Static card and table rims leave their figures in place.
        const edge = depth > 0 && depth < rim ? Math.sin(Math.PI * depth / rim) : 0;
        refraction[pixel] = 128 + 255 * nx * .4 * edge;
        refraction[pixel + 1] = 128 + 255 * ny * .4 * edge;
      }
      refraction[pixel + 3] = 255;
    }
  }
  return { width: columns, height: rows, range, refraction, dispersion };
}

// A fixed overhead light stays on even when the pointer rests at the optical axis.
// Tilting the lens moves its reflection continuously along the curved lip.
export function glassLightDirection(x, y) {
  const angle = -2.08 + (x ?? -.45) * 1.28 + (y ?? -.8) * .48;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

// Project the local surface normal onto the light axis. Opposite shoulders
// separate wavelengths, while tangential edges and the core remain achromatic.
export function glassLightMatrices(x, y, range) {
  const { x: ux, y: uy } = glassLightDirection(x, y);
  const xx = ux * ux, xy = ux * uy, yy = uy * uy;
  const bend = [
    1, 0, ux / range, 0, 0,
    0, 1, uy / range, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 1, 0,
  ];
  const color = [
    xx, xy, 0, 0, .5 * (1 - xx - xy),
    xy, yy, 0, 0, .5 * (1 - xy - yy),
    0, 0, 0, 0, 0,
    0, 0, 0, 1, 0,
  ];
  return { bend, color };
}
