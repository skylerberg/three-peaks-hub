// Selection in, ZIP out. The whole export is a pure function of what was
// picked, the settings each component already has, and one shot template --
// nothing here is stored, and nothing on the server knows a scene exists.

import {
  buildScene,
  DEFAULT_SCENE_RENDER,
  SCENE_FILE_NAME,
  validateScene,
  type RenderSpec,
  type SceneDocument,
  type SceneIssue,
} from '@three-peaks/shared';
import { planScene, type SceneSelection } from './assets.ts';
import { DEFAULT_SCENE_TEMPLATE_ID, sceneTemplate } from './templates.ts';
import type { SceneAssetRenderer } from './render.ts';
import { writeZip, ZIP_EPOCH, type ZipInput } from './zip.ts';

// A refusal a person is meant to read, carrying the machine-readable half for
// a screen that wants to point at the offending field.
export class SceneExportError extends Error {
  readonly issues: readonly SceneIssue[];

  constructor(message: string, issues: readonly SceneIssue[] = []) {
    super(message);
    this.name = 'SceneExportError';
    this.issues = issues;
  }
}

export interface SceneBundleProgress {
  built: number;
  total: number;
  // What is being built right now, for a screen with a progress line.
  label: string;
}

export interface SceneBundleRequest {
  project_name: string;
  // ISO 8601, passed in rather than read here, so two exports of one selection
  // differ in this and nothing else.
  generated_at: string;
  selection: SceneSelection;
  template?: string;
  render?: Omit<RenderSpec, 'frame_range'>;
  onProgress?: (progress: SceneBundleProgress) => void;
  // Injected by the tests. Left out, the real one is loaded below.
  renderAsset?: SceneAssetRenderer;
}

export interface SceneBundle {
  zip: Blob;
  document: SceneDocument;
}

function describeIssues(issues: readonly SceneIssue[]): string {
  const first = `${issues[0].path} ${issues[0].message}`;
  const rest = issues.length - 1;
  return rest > 0
    ? `This scene cannot be exported: ${first}, and ${rest} more like it.`
    : `This scene cannot be exported: ${first}.`;
}

function stampFrom(generated_at: string): Date {
  const at = new Date(generated_at);
  return Number.isNaN(at.getTime()) ? ZIP_EPOCH : at;
}

/**
 * Builds the bundle and hands back both halves: the ZIP to save, and the
 * document inside it for a screen that wants to say what it just wrote.
 */
export async function buildSceneBundle(request: SceneBundleRequest): Promise<SceneBundle> {
  const plan = planScene(request.selection);
  if (plan.instances.length === 0) {
    throw new SceneExportError('Nothing is selected, so there is no scene to export.');
  }

  const templateId = request.template ?? DEFAULT_SCENE_TEMPLATE_ID;
  const template = sceneTemplate(templateId);
  if (!template) throw new SceneExportError(`There is no “${templateId}” shot template.`);

  const render = request.render ?? DEFAULT_SCENE_RENDER;
  const [frameWidth, frameHeight] = render.resolution;
  const shots = template.build({
    groups: plan.groups,
    instances: plan.instances,
    extent: plan.extent,
    aspect: frameHeight > 0 ? frameWidth / frameHeight : 1,
  });
  const document = buildScene({
    project_name: request.project_name,
    generated_at: request.generated_at,
    assets: plan.assets,
    instances: plan.instances,
    shots: shots.shots,
    camera: shots.camera,
    lighting: shots.lighting,
    render,
  });

  // Before a single .glb is built. Exporting a deck is a minute of geometry and
  // textures, and a document the importer would refuse is worth hearing about
  // at the start of that minute rather than the end of it.
  const issues = validateScene(document);
  if (issues.length > 0) throw new SceneExportError(describeIssues(issues), issues);

  // Reached only here, which is what keeps three out of every graph that only
  // wants to plan a scene rather than draw one.
  const renderAsset = request.renderAsset ?? (await import('./render.ts')).componentRenderer();

  const entries: ZipInput[] = [
    {
      name: SCENE_FILE_NAME,
      bytes: new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`),
      compress: true,
    },
  ];

  const total = plan.builds.length;
  for (const build of plan.builds) {
    request.onProgress?.({ built: entries.length - 1, total, label: build.label });
    entries.push({ name: build.path, bytes: await renderAsset(build) });
  }
  request.onProgress?.({ built: total, total, label: '' });

  return { zip: await writeZip(entries, stampFrom(request.generated_at)), document };
}
