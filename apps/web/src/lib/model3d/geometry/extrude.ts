// A bevel in ExtrudeGeometry grows the piece: the outline it is given becomes
// the flat face, and the bevel then pushes out past it in x and y and past the
// depth in z. Left alone, a 63.5 mm card exports 63.66 mm across and thicker
// than the stock it was told to be -- which is exactly the number this tool
// exists to get right.
//
// Offsetting the bevel inwards by its own size, and taking it out of the depth,
// puts the widest point of the piece back on the size that was asked for.
export function bevelledExtrusion(thickness: number, bevel: number) {
  if (bevel <= 0) {
    return { depth: thickness, bevelEnabled: false, steps: 1 } as const;
  }

  return {
    depth: thickness - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    steps: 1,
  } as const;
}
