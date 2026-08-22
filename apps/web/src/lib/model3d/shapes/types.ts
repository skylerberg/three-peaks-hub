export interface Point {
  x: number;
  y: number;
}

// A closed ring, with the first point NOT repeated at the end.
export type Ring = Point[];

// One filled region: an outer contour and the rings punched out of it.
export interface Outline {
  contour: Ring;
  holes: Ring[];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
