import { BufferAttribute, type BufferGeometry } from 'three';
import type { Bounds } from '../shapes/types.ts';

export const FRONT_GROUP = 0;
export const BACK_GROUP = 1;
export const RIM_GROUP = 2;

// Only a face that is genuinely flat counts as a cap. Loose enough and the
// bevel ring joins it, which puts printed artwork on what is physically the cut
// edge of the stock.
const CAP_NORMAL_MIN = 0.99;

// ExtrudeGeometry emits two groups -- both lids together, then the sides -- so
// the front and back of a card cannot carry different artwork. This repartitions
// the triangles into three: front, back, and everything in between.
//
// The output is non-indexed, so a triangle is three consecutive vertices in
// every attribute and reordering is a copy rather than a remap.
export function assignFaceGroups(geometry: BufferGeometry): void {
  if (geometry.index) {
    throw new Error('assignFaceGroups needs a non-indexed geometry');
  }

  const normal = geometry.getAttribute('normal');
  const triangleCount = normal.count / 3;
  const buckets: number[][] = [[], [], []];

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const base = triangle * 3;
    const nz = (normal.getZ(base) + normal.getZ(base + 1) + normal.getZ(base + 2)) / 3;
    const group =
      nz >= CAP_NORMAL_MIN ? FRONT_GROUP : nz <= -CAP_NORMAL_MIN ? BACK_GROUP : RIM_GROUP;
    buckets[group].push(triangle);
  }

  reorderTriangles(geometry, buckets.flat());

  geometry.clearGroups();
  let start = 0;
  buckets.forEach((bucket, materialIndex) => {
    if (bucket.length === 0) return;
    geometry.addGroup(start, bucket.length * 3, materialIndex);
    start += bucket.length * 3;
  });
}

function reorderTriangles(geometry: BufferGeometry, order: readonly number[]): void {
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const source = attribute.array;
    if (!(source instanceof Float32Array)) continue;

    const stride = attribute.itemSize * 3;
    const target = new Float32Array(source.length);
    order.forEach((triangle, index) => {
      target.set(source.subarray(triangle * stride, triangle * stride + stride), index * stride);
    });
    geometry.setAttribute(name, new BufferAttribute(target, attribute.itemSize));
  }
}

// ExtrudeGeometry's own UVs are world coordinates in metres, which sample one
// corner of a texture. These map the cap faces across the artwork instead.
export function remapCapUVs(geometry: BufferGeometry, bounds: Bounds): void {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  for (let i = 0; i < position.count; i += 1) {
    const nz = normal.getZ(i);
    if (Math.abs(nz) < CAP_NORMAL_MIN) continue;

    const x = position.getX(i);
    const y = position.getY(i);
    // Textures are exported with flipY off, as glTF requires, so v = 0 is the
    // first row of the image and belongs at the top of the piece.
    const v = (bounds.maxY - y) / height;
    // The back is seen from behind, so its u runs the other way. Without this
    // the reverse of every card reads mirrored.
    const u = nz > 0 ? (x - bounds.minX) / width : (bounds.maxX - x) / width;
    uv.setXY(i, u, v);
  }

  uv.needsUpdate = true;
}
