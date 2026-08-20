// Re-exported through a barrel so consumers import from '@three-peaks/shared/api'
// and never name the generated file directly — its shape is openapi-typescript's
// business, not a call site's.
export type { paths, components, operations } from './schema.generated.ts';
