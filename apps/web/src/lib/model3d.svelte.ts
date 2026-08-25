import type { components } from '@three-peaks/shared/api';
import {
  DEFAULT_CARD_SETTINGS,
  defaultSettingsFor,
  type ModelKind,
  type ModelSettings,
} from '@three-peaks/shared';
import { ApiError, api, assertOk } from '../api/client.ts';

type File = components['schemas']['File'];

// Long enough that dragging a slider is one request rather than sixty, short
// enough that letting go and closing the tab still saves.
const SAVE_DELAY_MS = 600;

class ModelStore {
  file = $state<File | null>(null);
  settings = $state<ModelSettings>({ ...DEFAULT_CARD_SETTINGS });
  loading = $state(false);
  saving = $state(false);
  // Remembered per kind, so switching to wood and back does not reset a card
  // that was already dialled in.
  #remembered = new Map<ModelKind, ModelSettings>();
  #timer: ReturnType<typeof setTimeout> | null = null;

  // Two loads are routinely in flight at once when a screen opens and a
  // realtime event lands. Only the newest may assign.
  #generation = 0;

  // Settings saved elsewhere. The file row is untouched by this event because
  // the image did not change, and #remembered is left alone: it holds what this
  // person dialled in for the other kind, which is theirs and not the row's.
  applySettings(settings: ModelSettings): void {
    this.settings = settings;
  }

  async load(fileId: string): Promise<void> {
    this.#generation += 1;
    const generation = this.#generation;
    this.loading = true;

    try {
      const [row, settings] = await Promise.all([
        api.GET('/api/files/{id}', { params: { path: { id: fileId } } }),
        this.#fetchSettings(fileId),
      ]);
      const file = assertOk(row);

      if (generation !== this.#generation) return;
      this.file = file;
      this.#remembered.clear();
      this.#remembered.set(settings.kind, settings);
      this.settings = settings;
    } finally {
      if (generation === this.#generation) this.loading = false;
    }
  }

  async #fetchSettings(fileId: string): Promise<ModelSettings> {
    try {
      const saved = assertOk(
        await api.GET('/api/models/{fileId}', { params: { path: { fileId } } })
      );
      return saved.settings as ModelSettings;
    } catch (error) {
      // 404 is the normal answer for an image nobody has dialled in yet, and
      // the defaults are what the studio is supposed to open on.
      if (error instanceof ApiError && error.status === 404) return { ...DEFAULT_CARD_SETTINGS };
      throw error;
    }
  }

  update(patch: Partial<ModelSettings>): void {
    this.settings = { ...this.settings, ...patch } as ModelSettings;
    this.#remembered.set(this.settings.kind, this.settings);
  }

  setKind(kind: ModelKind): void {
    if (this.settings.kind === kind) return;
    this.settings = this.#remembered.get(kind) ?? defaultSettingsFor(kind);
    this.#remembered.set(kind, this.settings);
  }

  // Debounced rather than fired per keystroke, and the pending timer is cleared
  // first so the last edit wins rather than the first.
  scheduleSave(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.save();
    }, SAVE_DELAY_MS);
  }

  async save(): Promise<void> {
    const file = this.file;
    if (!file) return;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    this.saving = true;
    try {
      assertOk(
        await api.PUT('/api/models/{fileId}', {
          params: { path: { fileId: file.id } },
          // $state hands back a proxy, and structured-cloning one through fetch
          // throws. This is also the read-back the settings actually sent.
          body: { settings: $state.snapshot(this.settings) as ModelSettings },
        })
      );
    } finally {
      this.saving = false;
    }
  }

  reset(): void {
    // Generation first, for the reason files.svelte.ts spells out.
    this.#generation += 1;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.file = null;
    this.settings = { ...DEFAULT_CARD_SETTINGS };
    this.#remembered.clear();
    this.loading = false;
    this.saving = false;
  }
}

export const models = new ModelStore();
