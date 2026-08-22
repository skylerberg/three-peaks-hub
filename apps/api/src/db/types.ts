// Hand-written, and what the app imports. It re-exports the generated module
// and is the place any branding or override goes — so a regeneration never
// clobbers a deliberate type decision.
import type { ModelSettings } from '@three-peaks/shared';
import type {
  ComponentModel as GeneratedComponentModel,
  DB as GeneratedDB,
} from './types.generated.ts';

export type * from './types.generated.ts';

// Introspection can only see `jsonb`, so the generated column is an untyped
// `Json`. The shape is the one ArkType validated on the way in, and saying so
// here is what stops every read from re-narrowing a value the API already
// guarantees.
/** @public -- exported to shadow the generated interface of the same name. */
export interface ComponentModel extends Omit<GeneratedComponentModel, 'settings'> {
  settings: ModelSettings;
}

export interface DB extends Omit<GeneratedDB, 'component_model'> {
  component_model: ComponentModel;
}
