import { readFileSync } from 'node:fs';

// Getters rather than captured values: tests flip process.env at runtime, and a
// snapshot taken at import would make every such test a no-op that passes.

function parseStrictBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Deliberately strict. '1' silently reading as false is how a proxy config
  // ends up counting every request against the load balancer's own address.
  throw new Error(`${name} must be exactly "true" or "false", got ${JSON.stringify(raw)}`);
}

function parseStrictHops(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer, got ${raw}`);
  return Number(raw);
}

function parseInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const env = {
  get port(): number {
    return parseInteger(process.env.PORT, 17310);
  },
  get environment(): string {
    return process.env.ENVIRONMENT ?? 'development';
  },
  get isProduction(): boolean {
    return this.environment === 'production';
  },
  get isTest(): boolean {
    return this.environment === 'test';
  },

  db: {
    get hostname(): string {
      return process.env.DB_HOSTNAME ?? '127.0.0.1';
    },
    get port(): number {
      return parseInteger(process.env.DB_PORT, 5432);
    },
    get user(): string {
      return process.env.DB_USER ?? 'postgres';
    },
    get password(): string {
      return process.env.DB_PASSWORD ?? '';
    },
    get database(): string {
      return process.env.DB_DATABASE ?? 'three_peaks_hub';
    },
    get caCert(): string | null {
      const path = process.env.DB_CA_CERT_PATH;
      return path ? readFileSync(path, 'utf8') : null;
    },
    get poolMax(): number {
      return parseInteger(process.env.DB_POOL_MAX, 10);
    },
    get maintenanceDatabase(): string {
      return process.env.DB_MAINTENANCE_DATABASE ?? 'postgres';
    },
  },

  storage: {
    get driver(): 'disk' | 'gcs' {
      return process.env.STORAGE_DRIVER === 'gcs' ? 'gcs' : 'disk';
    },
    get diskRoot(): string {
      return process.env.STORAGE_DISK_ROOT ?? './data/uploads';
    },
    get gcsBucket(): string {
      return process.env.STORAGE_GCS_BUCKET ?? '';
    },
  },

  get redisUrl(): string | null {
    return process.env.REDIS_URL || null;
  },
  get corsOrigins(): string[] {
    return (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  },
  get appUrlBase(): string {
    return process.env.APP_URL_BASE ?? 'http://localhost:17300';
  },
  get trustProxy(): boolean {
    return parseStrictBoolean('TRUST_PROXY', process.env.TRUST_PROXY, false);
  },
  get trustProxyHops(): number {
    return parseStrictHops('TRUST_PROXY_HOPS', process.env.TRUST_PROXY_HOPS, 1);
  },

  get passwordResetSecret(): string {
    const secret = process.env.PASSWORD_RESET_SECRET;
    if (secret) return secret;
    if (this.isProduction) throw new Error('PASSWORD_RESET_SECRET is required in production');
    return 'dev-only-password-reset-secret';
  },
  get emailTokenSecret(): string {
    return process.env.EMAIL_TOKEN_SECRET || this.passwordResetSecret;
  },

  canva: {
    // The audience every app token carries, and the only thing binding one to
    // OUR app rather than to any other app on Canva. Absent, the routes that
    // read it answer 503 rather than verifying against nothing.
    get appId(): string | undefined {
      return process.env.CANVA_APP_ID || undefined;
    },
    get jwksUrl(): string {
      return `https://api.canva.com/rest/v1/apps/${this.appId ?? ''}/jwks`;
    },
  },

  email: {
    get driver(): 'console' | 'ses' {
      return process.env.EMAIL_DRIVER === 'ses' ? 'ses' : 'console';
    },
    get sesRegion(): string | undefined {
      return process.env.SES_REGION ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
    },
    get fromAddress(): string {
      return process.env.SES_FROM_ADDRESS ?? '';
    },
  },
};

// Called at module load from src/index.ts. Both of these fail the boot rather
// than the request, because both failures are otherwise invisible: a bad proxy
// setting quietly mis-attributes every rate limit, and a bad SES setting throws
// inside a post-commit hook where the error is caught and logged and the deploy
// still reports healthy.
export function assertProxyConfig(): void {
  parseStrictBoolean('TRUST_PROXY', process.env.TRUST_PROXY, false);
  parseStrictHops('TRUST_PROXY_HOPS', process.env.TRUST_PROXY_HOPS, 1);
}

export function assertEmailConfig(): void {
  if (env.email.driver !== 'ses') return;
  if (!env.email.fromAddress) {
    throw new Error('SES_FROM_ADDRESS is required when EMAIL_DRIVER=ses');
  }
  if (!env.email.sesRegion) {
    throw new Error(
      'SES_REGION (or AWS_REGION / AWS_DEFAULT_REGION) is required when EMAIL_DRIVER=ses'
    );
  }
}

export function assertStorageConfig(): void {
  if (env.storage.driver === 'gcs' && !env.storage.gcsBucket) {
    throw new Error('STORAGE_GCS_BUCKET is required when STORAGE_DRIVER=gcs');
  }
}
