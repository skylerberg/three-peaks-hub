import { BufferGeometry, Float32BufferAttribute } from 'three';
import {
  BOX_FACES,
  boxNetRegions,
  type BoxFace,
  type BoxModelSettings,
  type UvRect,
} from '@three-peaks/shared';
import { MM } from '../units.ts';

type Vec = readonly [number, number, number];

interface FaceFrame {
  normal: Vec;
  right: Vec;
  down: Vec;
}

// Where the wrap's u and v run on each face. boxNetRegions lays the image out
// as the printer's cross, so the four sides unroll left to right and the lid
// and the base fold away from the front -- and picking `down` to match that
// leaves `down x right` equal to `normal` on all six, which is why one winding
// rule serves every face below.
const FACE_FRAMES: Record<BoxFace, FaceFrame> = {
  front: { normal: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0] },
  back: { normal: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0] },
  left: { normal: [-1, 0, 0], right: [0, 0, 1], down: [0, -1, 0] },
  right: { normal: [1, 0, 0], right: [0, 0, -1], down: [0, -1, 0] },
  top: { normal: [0, 1, 0], right: [1, 0, 0], down: [0, 0, 1] },
  bottom: { normal: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1] },
};

const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const sum = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const scaled = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];

const between = (a: Vec, b: Vec): Vec => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];

const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const distanceSquared = (a: Vec, b: Vec): number => dot(between(a, b), between(a, b));

// How far the box reaches along one of its own axes. The frames are unit axes,
// so this is a component pick that does not care about sign.
const extentAlong = (axis: Vec, size: Vec): number =>
  Math.abs(axis[0]) * size[0] + Math.abs(axis[1]) * size[1] + Math.abs(axis[2]) * size[2];

function facePoint(face: BoxFace, size: Vec, u01: number, v01: number): Vec {
  const frame = FACE_FRAMES[face];
  return sum(
    scaled(frame.normal, extentAlong(frame.normal, size) / 2),
    sum(
      scaled(frame.right, (u01 - 0.5) * extentAlong(frame.right, size)),
      scaled(frame.down, (v01 - 0.5) * extentAlong(frame.down, size))
    )
  );
}

// The flat part of a face: its rectangle pulled in by the chamfer on all four
// sides, wound so the first three vertices already face outwards.
function insetCorners(face: BoxFace, size: Vec, chamfer: number): Vec[] {
  const frame = FACE_FRAMES[face];
  const u = chamfer / extentAlong(frame.right, size);
  const v = chamfer / extentAlong(frame.down, size);
  return [
    facePoint(face, size, u, v),
    facePoint(face, size, u, 1 - v),
    facePoint(face, size, 1 - u, 1 - v),
    facePoint(face, size, 1 - u, v),
  ];
}

function cornersTowards(face: BoxFace, direction: Vec, size: Vec, chamfer: number): Vec[] {
  return insetCorners(face, size, chamfer).sort((a, b) => dot(b, direction) - dot(a, direction));
}

// Every pair of faces that share an edge, each pair listed once and owned by
// whichever comes first in BOX_FACES. Opposite faces fall out because their
// normals are anti-parallel rather than perpendicular.
const BOX_EDGES: (readonly [BoxFace, BoxFace])[] = BOX_FACES.flatMap((face, index) =>
  BOX_FACES.slice(index + 1)
    .filter((other) => dot(FACE_FRAMES[face].normal, FACE_FRAMES[other].normal) === 0)
    .map((other) => [face, other] as const)
);

const BOX_CORNERS = [-1, 1].flatMap((x) =>
  [-1, 1].flatMap((y) =>
    [-1, 1].map((z) => {
      const direction: Vec = [x, y, z];
      return {
        direction,
        faces: BOX_FACES.filter((face) => dot(FACE_FRAMES[face].normal, direction) > 0),
      };
    })
  )
);

interface Written {
  positions: number[];
  uvs: number[];
}

function pushTriangle(
  out: Written,
  face: BoxFace,
  regions: Record<BoxFace, UvRect>,
  size: Vec,
  triangle: readonly [Vec, Vec, Vec],
  outward: Vec
): void {
  const [a, b, c] = triangle;
  const wound = dot(cross(between(a, b), between(a, c)), outward) >= 0 ? [a, b, c] : [a, c, b];
  const frame = FACE_FRAMES[face];
  const rect = regions[face];
  const uSpan = extentAlong(frame.right, size);
  const vSpan = extentAlong(frame.down, size);

  for (const point of wound) {
    out.positions.push(point[0], point[1], point[2]);
    // Planar projection onto the face this triangle belongs to, the way
    // remapCapUVs does it for a card's two caps.
    const u01 = 0.5 + dot(point, frame.right) / uSpan;
    const v01 = 0.5 + dot(point, frame.down) / vSpan;
    out.uvs.push(rect.u0 + u01 * (rect.u1 - rect.u0), rect.v0 + v01 * (rect.v1 - rect.v0));
  }
}

// The chamfer strip along one edge, taken by the face that owns the edge. Its
// far vertices sit exactly on that face's own boundary once projected, so the
// wrap runs over the edge instead of stopping short of it.
function pushEdgeStrip(
  out: Written,
  face: BoxFace,
  other: BoxFace,
  regions: Record<BoxFace, UvRect>,
  size: Vec,
  chamfer: number
): void {
  const near = cornersTowards(face, FACE_FRAMES[other].normal, size, chamfer).slice(0, 2);
  const far = cornersTowards(other, FACE_FRAMES[face].normal, size, chamfer).slice(0, 2);
  // The two edges are read off different faces and may be walked in opposite
  // directions; pairing the closer ends is what stops the strip crossing itself.
  if (distanceSquared(near[0], far[0]) > distanceSquared(near[0], far[1])) far.reverse();

  const outward = sum(FACE_FRAMES[face].normal, FACE_FRAMES[other].normal);
  pushTriangle(out, face, regions, size, [near[0], near[1], far[1]], outward);
  pushTriangle(out, face, regions, size, [near[0], far[1], far[0]], outward);
}

export function buildBoxGeometry(settings: BoxModelSettings): BufferGeometry {
  const size: Vec = [settings.width_mm * MM, settings.height_mm * MM, settings.depth_mm * MM];
  // Cut inwards rather than added on, so the widest point of the box is the
  // size that was asked for -- the correction bevelledExtrusion makes for a
  // card, made here against the shortest side because a chamfer meets itself
  // on all three axes at once.
  const chamfer = Math.min(settings.corner_bevel_mm * MM, Math.min(...size) / 3);
  const regions = boxNetRegions(settings);
  const out: Written = { positions: [], uvs: [] };
  const geometry = new BufferGeometry();

  for (const face of BOX_FACES) {
    const start = out.positions.length / 3;
    const corners = insetCorners(face, size, chamfer);
    const normal = FACE_FRAMES[face].normal;
    pushTriangle(out, face, regions, size, [corners[0], corners[1], corners[2]], normal);
    pushTriangle(out, face, regions, size, [corners[0], corners[2], corners[3]], normal);

    // A chamfer of nothing leaves the strips and the corner patches with no
    // area, and a zero-area triangle has no normal to compute.
    if (chamfer > 0) {
      for (const [owner, other] of BOX_EDGES) {
        if (owner === face) pushEdgeStrip(out, face, other, regions, size, chamfer);
      }
      for (const corner of BOX_CORNERS) {
        if (corner.faces[0] !== face) continue;
        const patch = corner.faces.map(
          (each) => cornersTowards(each, corner.direction, size, chamfer)[0]
        );
        pushTriangle(out, face, regions, size, [patch[0], patch[1], patch[2]], corner.direction);
      }
    }

    geometry.addGroup(start, out.positions.length / 3 - start, BOX_FACES.indexOf(face));
  }

  geometry.setAttribute('position', new Float32BufferAttribute(out.positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(out.uvs, 2));
  // Non-indexed, so this is one flat normal per triangle, which is what a
  // chamfer wants: a crisp line of highlight along the edge rather than a
  // rolled one that reads as a pillow.
  geometry.computeVertexNormals();

  return geometry;
}
