import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// A card is 60 mm across and the scene is in metres, so the default near plane
// would clip the whole model away.
const NEAR = 0.001;
const FAR = 10;

export class ModelViewer {
  readonly scene = new Scene();
  #renderer: WebGLRenderer;
  #camera: PerspectiveCamera;
  #controls: OrbitControls;
  #observer: ResizeObserver;
  #frame = 0;
  #content: Group | null = null;

  constructor(canvas: HTMLCanvasElement, background: string) {
    this.#renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.#renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.#renderer.outputColorSpace = SRGBColorSpace;
    this.#renderer.toneMapping = ACESFilmicToneMapping;

    this.scene.background = new Color(background);

    this.#camera = new PerspectiveCamera(35, 1, NEAR, FAR);
    this.#camera.position.set(0.09, 0.07, 0.16);

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
    this.#controls.minDistance = 0.03;
    this.#controls.maxDistance = 1;

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
  }

  setBackground(background: string): void {
    this.scene.background = new Color(background);
  }

  resetView(): void {
    this.#camera.position.set(0.09, 0.07, 0.16);
    this.#controls.target.set(0, 0, 0);
    this.#controls.update();
  }

  #resize(canvas: HTMLCanvasElement): void {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(width, height, false);
  }

  dispose(): void {
    cancelAnimationFrame(this.#frame);
    this.#observer.disconnect();
    this.#controls.dispose();
    this.#renderer.dispose();
  }
}
