import { Shape } from 'three';

// Centred on the origin, in metres, with real arcs rather than a polygon: the
// extruder's curveSegments decides how round the corner is, and a card's is the
// silhouette people notice first.
export function roundedRectShape(width: number, height: number, radius: number): Shape {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const r = Math.max(0, Math.min(radius, halfWidth, halfHeight));

  const shape = new Shape();
  shape.moveTo(-halfWidth + r, -halfHeight);
  shape.lineTo(halfWidth - r, -halfHeight);
  if (r > 0) shape.absarc(halfWidth - r, -halfHeight + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(halfWidth, halfHeight - r);
  if (r > 0) shape.absarc(halfWidth - r, halfHeight - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-halfWidth + r, halfHeight);
  if (r > 0) shape.absarc(-halfWidth + r, halfHeight - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-halfWidth, -halfHeight + r);
  if (r > 0) shape.absarc(-halfWidth + r, -halfHeight + r, r, Math.PI, (3 * Math.PI) / 2, false);
  shape.closePath();

  return shape;
}
