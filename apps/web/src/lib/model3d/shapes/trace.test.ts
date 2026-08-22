import { describe, expect, it } from 'vitest';
import { buildMask, traceRings, type ImageDataLike } from './trace.ts';

// Rows of '#' (opaque) and '.' (transparent), so a fixture reads as the shape
// it is meant to be.
function stencil(rows: string[], opaque = 255): ImageDataLike {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);

  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      const offset = (y * width + x) * 4;
      const on = cell === '#';
      data[offset] = on ? 0 : 255;
      data[offset + 1] = on ? 0 : 255;
      data[offset + 2] = on ? 0 : 255;
      data[offset + 3] = on ? opaque : 0;
    });
  });

  return { width, height, data };
}

describe('buildMask', () => {
  it('reads the alpha channel against the threshold', () => {
    const faint = stencil(['##', '##'], 100);
    expect([...buildMask(faint, { source: 'alpha', threshold: 0.3 })]).toEqual([1, 1, 1, 1]);
    expect([...buildMask(faint, { source: 'alpha', threshold: 0.5 })]).toEqual([0, 0, 0, 0]);
  });

  // A JPEG has no alpha at all, so luminance is the only outline it carries.
  it('reads luminance as distance from the background, not as darkness', () => {
    const image = stencil(['.#.', '...']);
    // Every pixel is opaque here, so only the colour distinguishes them.
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;

    const mask = buildMask(image, { source: 'luminance', threshold: 0.5 });
    expect([...mask]).toEqual([0, 1, 0, 0, 0, 0]);
  });
});

describe('traceRings', () => {
  it('walks the boundary of a filled square', () => {
    const rings = traceRings(stencil(['....', '.##.', '.##.', '....']), {
      source: 'alpha',
      threshold: 0.5,
    });

    expect(rings).toHaveLength(1);
    // A 2x2 block has eight unit edges around it.
    expect(rings[0]).toHaveLength(8);
  });

  it('finds nothing in an empty image', () => {
    expect(traceRings(stencil(['..', '..']), { source: 'alpha', threshold: 0.5 })).toHaveLength(0);
  });

  // The ring the hole makes is what turns into shape.holes, so losing it fills
  // the piece in solid.
  it('emits a second ring for a hole', () => {
    const rings = traceRings(stencil(['.....', '.###.', '.#.#.', '.###.', '.....']), {
      source: 'alpha',
      threshold: 0.5,
    });
    expect(rings).toHaveLength(2);
  });

  it('emits one ring per separate piece', () => {
    const rings = traceRings(stencil(['#..#', '....', '#..#']), {
      source: 'alpha',
      threshold: 0.5,
    });
    expect(rings).toHaveLength(4);
  });

  // Two pixels meeting at a corner are one piece to anyone drawing a
  // silhouette, so the tracer walks through the corner rather than round it.
  it('treats a diagonal touch as one piece', () => {
    const rings = traceRings(stencil(['#.', '.#']), { source: 'alpha', threshold: 0.5 });
    expect(rings).toHaveLength(1);
  });

  it('closes a shape that runs off the edge of the image', () => {
    const rings = traceRings(stencil(['##', '##']), { source: 'alpha', threshold: 0.5 });
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(8);
  });
});
