/**
 * Circle packing for the story cloud.
 *
 * Rolled by hand rather than pulling in d3-force for two reasons. A force
 * simulation is non-deterministic and settles differently on every render,
 * which makes a picture a newsroom is meant to trust feel unstable. And it
 * animates for hundreds of ticks on the main thread for a layout that here is
 * fundamentally a packing problem, not a physics one.
 *
 * The approach: sort by radius, place each circle on an expanding spiral at the
 * first position where it collides with nothing. Big stories land near the
 * centre, small ones fill the gaps, and the same input always produces the same
 * picture.
 */
export interface PackInput { id: string; radius: number }
export interface PackedCircle { id: string; x: number; y: number; radius: number }

export function packCircles(items: PackInput[], padding = 4): {
  circles: PackedCircle[];
  width: number;
  height: number;
} {
  const sorted = [...items].sort((a, b) => b.radius - a.radius);
  const placed: PackedCircle[] = [];

  const fits = (x: number, y: number, r: number): boolean => {
    for (const c of placed) {
      const dx = c.x - x;
      const dy = c.y - y;
      const min = c.radius + r + padding;
      if (dx * dx + dy * dy < min * min) return false;
    }
    return true;
  };

  for (const item of sorted) {
    const r = item.radius;
    if (placed.length === 0) { placed.push({ id: item.id, x: 0, y: 0, radius: r }); continue; }

    // Archimedean spiral. Step scales with radius so large circles do not crawl
    // outward one pixel at a time through space they can never fit into.
    const step = Math.max(2, r * 0.35);
    let angle = 0;
    let placedIt = false;

    for (let i = 0; i < 20000; i += 1) {
      const dist = step * Math.sqrt(i) * 1.4;
      angle += Math.PI * (3 - Math.sqrt(5)); // golden angle, avoids spoke artefacts
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;
      if (fits(x, y, r)) { placed.push({ id: item.id, x, y, radius: r }); placedIt = true; break; }
    }
    if (!placedIt) placed.push({ id: item.id, x: 0, y: 0, radius: r });
  }

  // Normalise into a positive coordinate space the SVG can use directly.
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const c of placed) {
    minX = Math.min(minX, c.x - c.radius);
    minY = Math.min(minY, c.y - c.radius);
    maxX = Math.max(maxX, c.x + c.radius);
    maxY = Math.max(maxY, c.y + c.radius);
  }
  const pad = 8;
  return {
    circles: placed.map((c) => ({ ...c, x: c.x - minX + pad, y: c.y - minY + pad })),
    width: (maxX - minX) + pad * 2,
    height: (maxY - minY) + pad * 2,
  };
}
