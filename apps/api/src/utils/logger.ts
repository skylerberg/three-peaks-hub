import { env } from '../config/env.ts';

type Fields = Record<string, unknown>;

// One line of JSON per event in production, shaped for Cloud Logging's
// `severity` field; readable text otherwise.
function serialize(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => serialize(item, seen));
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serialize(item, seen)])
    );
  }
  return value;
}

function emit(severity: string, message: string, fields?: Fields): void {
  const structured = process.env.LOG_FORMAT === 'json' || env.isProduction;
  if (structured) {
    const payload = serialize({ severity, message, ...fields }, new WeakSet());
    console.log(JSON.stringify(payload));
    return;
  }
  const suffix =
    fields && Object.keys(fields).length > 0
      ? ` ${JSON.stringify(serialize(fields, new WeakSet()))}`
      : '';
  console.log(`[${severity}] ${message}${suffix}`);
}

export const logger = {
  debug: (message: string, fields?: Fields) => emit('DEBUG', message, fields),
  info: (message: string, fields?: Fields) => emit('INFO', message, fields),
  warn: (message: string, fields?: Fields) => emit('WARNING', message, fields),
  error: (message: string, fields?: Fields) => emit('ERROR', message, fields),
};
