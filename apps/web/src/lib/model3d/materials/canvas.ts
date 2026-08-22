import { CanvasTexture, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';

export interface PaintedTexture {
  canvas: HTMLCanvasElement;
  image: ImageData;
}

export function paintCanvas(size: number): PaintedTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser did not give up a 2D canvas context');
  return { canvas, image: context.createImageData(size, size) };
}

export function commit(painted: PaintedTexture): HTMLCanvasElement {
  const context = painted.canvas.getContext('2d');
  if (!context) throw new Error('This browser did not give up a 2D canvas context');
  context.putImageData(painted.image, 0, 0);
  return painted.canvas;
}

// flipY off on every texture the exporter will see: glTF stores images with the
// first row at v = 0, and three's default flips them the other way. The UVs are
// written to match, so this and remapCapUVs have to agree.
export function textureFrom(canvas: HTMLCanvasElement, colour: boolean): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = colour ? SRGBColorSpace : LinearSRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
