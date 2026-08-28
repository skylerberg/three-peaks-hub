import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// A card is 60 mm across and the scene is in metres, so the default near plane
// would clip the whole model away. Both planes are re-derived per model rather
// than fixed: a 1200 mm board is framed twenty times further out than a card,
// and a far plane that suits one hides the other entirely.
const NEAREST = 0.001;

// The direction a model is first seen from. How far along it the camera sits is
// derived from the model's own size: a 300 mm box and a 500 mm board are five
// and nine times a card, and a fixed distance opens the camera inside them.
const VIEW_DIRECTION = new Vector3(0.09, 0.07, 0.16).normalize();
const FIT_MARGIN = 1.1;

// A rebuild reframes only once the camera has stopped framing the model at all
// -- inside it, or far enough out that it is a speck. Everything between leaves
// the view someone orbited to alone, which is most of what a slider does.
const TOO_CLOSE = 1.2;
const TOO_FAR = 8;
const ZOOM_IN = 0.15;
const ZOOM_OUT = 6;

// What an empty scene is framed for: a card, which is what the studio opens on.
const CARD_RADIUS = 0.055;

// The model sits on the orbit target, so its reach is the far corner of its own
// bounding box rather than that box's diagonal.
function contentRadius(group: Group): number {
  const box = new Box3().setFromObject(group);
  if (box.isEmpty()) return CARD_RADIUS;
  return new Vector3(
    Math.max(Math.abs(box.min.x), Math.abs(box.max.x)),
    Math.max(Math.abs(box.min.y), Math.abs(box.max.y)),
    Math.max(Math.abs(box.min.z), Math.abs(box.max.z))
  ).length();
}

export class ModelViewer {
  readonly scene = new Scene();
  #renderer: WebGLRenderer;
  #camera: PerspectiveCamera;
  #controls: OrbitControls;
  #observer: ResizeObserver;
  #frame = 0;
  #content: Group | null = null;
  #radius = CARD_RADIUS;

  constructor(canvas: HTMLCanvasElement, background: string) {
    this.#renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.#renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.#renderer.outputColorSpace = SRGBColorSpace;
    this.#renderer.toneMapping = ACESFilmicToneMapping;

    this.scene.background = new Color(background);

    this.#camera = new PerspectiveCamera(35, 1, NEAREST, 1);

    // Three lights, not one: a single source leaves the cut edge of a thin
    // piece unlit, which is the part the thickness setting exists to show.
    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.set(0.4, 0.8, 0.6);
    const fill = new DirectionalLight(0xffffff, 0.8);
    fill.position.set(-0.6, 0.1, 0.4);
    const rim = new DirectionalLight(0xffffff, 0.6);
    rim.position.set(0, -0.4, -0.8);
    this.scene.add(key, fill, rim, new AmbientLight(0xffffff, 0.5));

    this.#controls = new OrbitControls(this.#camera, canvas);
    this.#controls.enableDamping = true;
    this.resetView();

    this.#observer = new ResizeObserver(() => this.#resize(canvas));
    this.#observer.observe(canvas);
    this.#resize(canvas);

    const tick = () => {
      this.#frame = requestAnimationFrame(tick);
      this.#controls.update();
      this.#renderer.render(this.scene, this.#camera);
    };
    tick();
  }

  setContent(group: Group | null): void {
    if (this.#content) this.scene.remove(this.#content);
    this.#content = group;
    if (group) this.scene.add(group);
    if (!group) return;

    this.#radius = contentRadius(group);
    this.#applyRange();
    const distance = this.#camera.position.distanceTo(this.#controls.target);
    if (distance < this.#radius * TOO_CLOSE || distance > this.#radius * TOO_FAR) this.resetView();
  }

  setBackground(background: string): void {
    this.scene.background = new Color(background);
  }

  resetView(): void {
    this.#applyRange();
    this.#camera.position.copy(VIEW_DIRECTION).multiplyScalar(this.#fitDistance());
    this.#controls.target.set(0, 0, 0);
    this.#controls.update();
  }

  // The narrower of the two fields of view frames a sphere; on a portrait canvas
  // that is the horizontal one, and fitting the vertical alone crops the sides.
  #fitDistance(): number {
    const vertical = (this.#camera.fov * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.#camera.aspect);
    return (this.#radius / Math.sin(Math.min(vertical, horizontal) / 2)) * FIT_MARGIN;
  }

  #applyRange(): void {
    const fit = this.#fitDistance();
    this.#controls.minDistance = fit * ZOOM_IN;
    this.#controls.maxDistance = fit * ZOOM_OUT;
    this.#camera.near = Math.max(NEAREST, this.#radius / 100);
    this.#camera.far = fit * ZOOM_OUT * 2;
    this.#camera.updateProjectionMatrix();
  }

  #resize(canvas: HTMLCanvasElement): void {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    this.#camera.aspect = width / height;
    this.#renderer.setSize(width, height, false);
    this.#applyRange();
  }

  dispose(): void {
    cancelAnimationFrame(this.#frame);
    this.#observer.disconnect();
    this.#controls.dispose();
    this.#renderer.dispose();
  }
}
