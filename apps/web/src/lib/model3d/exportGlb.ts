import type { Object3D } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// Binary glTF rather than .gltf plus a folder of images: one file is what gets
// dragged into Blender, and the textures here are generated rather than files
// anyone has on disk to keep alongside it.
export async function exportGlb(scene: Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });

  if (!(result instanceof ArrayBuffer)) {
    throw new Error('The exporter returned JSON where binary was asked for');
  }

  return result;
}
